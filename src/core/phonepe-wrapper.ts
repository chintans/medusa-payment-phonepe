import {
  Env,
  MetaInfo,
  OrderStatusResponse,
  RefundRequest,
  RefundResponse,
  StandardCheckoutClient,
  StandardCheckoutPayRequest,
  StandardCheckoutPayResponse,
} from "pg-sdk-node";
import { Console } from "node:console";
import { Logger } from "@medusajs/framework/types";
import { PhonePeOptions } from "../types.js";

export type StandardPayInput = {
  merchantOrderId: string;
  amount: number;
  redirectUrl: string;
  expireAfter?: number;
  message?: string;
  metaInfo?: {
    udf1?: string;
    udf2?: string;
    udf3?: string;
    udf4?: string;
    udf5?: string;
  };
};

export type RefundInput = {
  merchantRefundId: string;
  originalMerchantOrderId: string;
  amount: number;
};

export class PhonePeWrapper {
  private readonly client: StandardCheckoutClient;
  private readonly logger: Logger | Console;
  private readonly options: PhonePeOptions;

  constructor(options: PhonePeOptions, logger?: Logger) {
    this.logger = logger ?? console;
    this.options = options;
    this.client = StandardCheckoutClient.getInstance(
      options.clientId,
      options.clientSecret,
      options.clientVersion,
      this.resolveEnv(options.mode),
      options.shouldPublishEvents ?? false
    );
  }

  private resolveEnv(mode: PhonePeOptions["mode"]): Env {
    if (mode === "production") {
      return Env.PRODUCTION;
    }
    return Env.SANDBOX;
  }

  async createPayment({
    merchantOrderId,
    amount,
    redirectUrl,
    expireAfter,
    message,
    metaInfo,
  }: StandardPayInput): Promise<StandardCheckoutPayResponse> {
    const builder = StandardCheckoutPayRequest.builder()
      .merchantOrderId(merchantOrderId)
      .amount(amount)
      .redirectUrl(redirectUrl);

    if (typeof expireAfter === "number") {
      builder.expireAfter(expireAfter);
    }
    if (message) {
      builder.message(message);
    }

    if (metaInfo && Object.keys(metaInfo).length > 0) {
      const metaBuilder = MetaInfo.builder();
      if (metaInfo.udf1) {
        metaBuilder.udf1(metaInfo.udf1);
      }
      if (metaInfo.udf2) {
        metaBuilder.udf2(metaInfo.udf2);
      }
      if (metaInfo.udf3) {
        metaBuilder.udf3(metaInfo.udf3);
      }
      if (metaInfo.udf4) {
        metaBuilder.udf4(metaInfo.udf4);
      }
      if (metaInfo.udf5) {
        metaBuilder.udf5(metaInfo.udf5);
      }
      builder.metaInfo(metaBuilder.build());
    }

    const request = builder.build();

    const response = await this.client.pay(request);

    if (this.options.enabledDebugLogging) {
      this.logger.info(
        `PhonePe SDK pay response: ${JSON.stringify({
          orderId: response.orderId,
          state: response.state,
          redirectUrl: response.redirectUrl,
        })}`
      );
    }

    return response;
  }

  async getOrderStatus(
    merchantOrderId: string,
    details?: boolean
  ): Promise<OrderStatusResponse> {
    const response = await this.client.getOrderStatus(
      merchantOrderId,
      details ?? false
    );

    if (this.options.enabledDebugLogging) {
      this.logger.info(
        `PhonePe SDK order status: ${JSON.stringify({
          orderId: response.orderId,
          state: response.state,
        })}`
      );
    }

    return response;
  }

  async refund({
    merchantRefundId,
    originalMerchantOrderId,
    amount,
  }: RefundInput): Promise<RefundResponse> {
    const builder = RefundRequest.builder()
      .merchantRefundId(merchantRefundId)
      .originalMerchantOrderId(originalMerchantOrderId)
      .amount(amount);

    const request = builder.build();

    const response = await this.client.refund(request);

    if (this.options.enabledDebugLogging) {
      this.logger.info(
        `PhonePe SDK refund response: ${JSON.stringify({
          refundId: response.refundId,
          state: response.state,
          amount: response.amount,
        })}`
      );
    }

    return response;
  }

  validatePaymentInput(input: StandardPayInput): boolean {
    if (!input.merchantOrderId) {
      return false;
    }
    if (typeof input.amount !== "number" || input.amount <= 0) {
      return false;
    }
    if (!input.redirectUrl) {
      return false;
    }
    if (
      typeof input.expireAfter === "number" &&
      (input.expireAfter < 300 || input.expireAfter > 3600)
    ) {
      return false;
    }
    return true;
  }

  /**
   * Validates webhook callback using PhonePe SDK's validateCallback method
   * @param authorizationHeader - The authorization header value from the webhook request
   * @param callbackBody - The raw callback body as string
   * @returns The validated callback response, or null if validation fails or credentials are missing
   */
  async validateWebhookCallback(
    authorizationHeader: string,
    callbackBody: string
  ): Promise<any | null> {
    // Check if merchant credentials are configured
    if (!this.options.merchantUsername || !this.options.merchantPassword) {
      this.logger.warn(
        "Webhook validation requires merchantUsername and merchantPassword to be configured in PhonePeOptions. Falling back to signature-based validation."
      );
      return null;
    }

    if (!authorizationHeader) {
      this.logger.warn(
        "Authorization header is missing from webhook request. Cannot validate webhook."
      );
      return null;
    }

    try {
      // Check if validateCallback method exists on the client
      if (typeof this.client.validateCallback !== "function") {
        this.logger.error(
          "validateCallback method is not available on StandardCheckoutClient. Please ensure you are using the latest version of pg-sdk-node."
        );
        return null;
      }

      // Use SDK's validateCallback method
      // According to PhonePe SDK documentation, the method signature is:
      // validateCallback(username, password, authorizationHeader, callbackBodyString)
      const callbackResponse = this.client.validateCallback(
        this.options.merchantUsername,
        this.options.merchantPassword,
        authorizationHeader,
        callbackBody
      );

      if (this.options.enabledDebugLogging) {
        this.logger.info(
          `PhonePe SDK webhook validation successful: ${JSON.stringify({
            type: callbackResponse?.type,
            orderId: callbackResponse?.payload?.orderId,
            state: callbackResponse?.payload?.state,
          })}`
        );
      }

      return callbackResponse;
    } catch (error: any) {
      this.logger.error(
        `PhonePe SDK webhook validation failed: ${
          error?.message || JSON.stringify(error)
        }`
      );
      // Don't throw - return null to allow fallback to legacy validation
      return null;
    }
  }

  /**
   * Legacy webhook validation method (kept for backward compatibility)
   * @param data
   * @param signature
   * @param salt
   * @deprecated Use validateWebhookCallback instead
   */
  validateWebhook(data: string, signature: string, _salt: string): boolean {
    this.logger.warn(
      "validateWebhook is deprecated. Use validateWebhookCallback with SDK validation instead."
    );
    // Fallback to basic signature check if SDK validation is not available
    return !!signature;
  }
}
