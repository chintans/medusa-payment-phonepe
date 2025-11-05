/**
 * PhonePe Payment Provider for MedusaJS v2
 * 
 * Step 1. Initiating Payment request
 * Step 2. Redirecting user to PhonePe Standard Checkout page
 * Step 3. Redirecting user to Merchant web page
 * Step 4. Status verification post redirection to merchant website
 * Step 5. Handling Payment Success, Pending and Failure
 * Step 6. Refund
 */

import { EOL } from "os";
import {
  AbstractPaymentProvider,
  Logger,
} from "@medusajs/framework/utils";
import {
  InitiatePaymentInput,
  InitiatePaymentOutput,
  AuthorizePaymentInput,
  AuthorizePaymentOutput,
  CapturePaymentInput,
  CapturePaymentOutput,
  CancelPaymentInput,
  CancelPaymentOutput,
  RefundPaymentInput,
  RefundPaymentOutput,
  UpdatePaymentInput,
  UpdatePaymentOutput,
  PaymentProviderError,
  PaymentProviderSessionResponse,
  PaymentSessionStatus,
} from "@medusajs/framework/types";
import {
  ErrorCodes,
  ErrorIntentStatus,
  PaymentIntentOptions,
  PaymentStatusCodeValues,
  PhonePeEvent,
  PhonePeOptions,
  PhonePeS2SResponse,
  PaymentRequestV2,
  PaymentResponseV2,
  OrderStatusResponseV2,
  RefundRequestV2,
  RefundResponseV2,
} from "../types";
import { PhonePeWrapper } from "./phonepe-wrapper";
import { isTooManyTries, retryAsync } from "ts-retry";

export type TransactionIdentifier = {
  merchantId: string;
  merchantOrderId: string;
};

abstract class PhonePeBase extends AbstractPaymentProvider<PhonePeOptions> {
  static identifier = "";

  protected readonly options_: PhonePeOptions;
  protected phonepe_: PhonePeWrapper;
  protected logger: Logger;
  static sequenceCount = 0;

  protected constructor(container: { logger: Logger }, options: PhonePeOptions) {
    super(container as any, options);
    this.logger = container.logger;
    this.options_ = options;
    this.init();
  }

  protected init(): void {
    this.phonepe_ =
      this.phonepe_ ||
      new PhonePeWrapper(
        {
          salt: this.options_.salt,
          merchantId: this.options_.merchantId,
          callbackUrl: this.options_.callbackUrl ?? "http://localhost:9000",
          redirectUrl: this.options_.redirectUrl,
          mode: this.options_.mode,
          clientId: this.options_.clientId,
          clientSecret: this.options_.clientSecret,
          tokenCacheEnabled: this.options_.tokenCacheEnabled,
          enabledDebugLogging: this.options_.enabledDebugLogging,
        },
        this.logger
      );
  }

  abstract get paymentIntentOptions(): PaymentIntentOptions;

  getPaymentIntentOptions(): PaymentIntentOptions {
    const options: PaymentIntentOptions = {};

    if (this?.paymentIntentOptions?.capture_method) {
      options.capture_method = this.paymentIntentOptions.capture_method;
    }

    if (this?.paymentIntentOptions?.setup_future_usage) {
      options.setup_future_usage = this.paymentIntentOptions.setup_future_usage;
    }

    if (this?.paymentIntentOptions?.payment_method_types) {
      options.payment_method_types =
        this.paymentIntentOptions.payment_method_types;
    }

    return options;
  }

  /**
   * Convert payment status from PhonePe API to MedusaJS payment status
   */
  private convertPaymentStatus(
    state: string,
    code: string
  ): PaymentSessionStatus {
    switch (state?.toUpperCase() || code?.toUpperCase()) {
      case "SUCCESS":
      case "PAYMENT_SUCCESS":
        return PaymentSessionStatus.AUTHORIZED;
      case "PENDING":
      case "PAYMENT_PENDING":
      case "PAYMENT_INITIATED":
        return PaymentSessionStatus.PENDING;
      case "FAILED":
      case "PAYMENT_ERROR":
      case "PAYMENT_DECLINED":
      case "BAD_REQUEST":
      case "INTERNAL_SERVER_ERROR":
      case "AUTHORIZATION_FAILED":
        return PaymentSessionStatus.ERROR;
      case "CANCELLED":
      case "PAYMENT_CANCELLED":
      case "TRANSACTION_NOT_FOUND":
        return PaymentSessionStatus.CANCELED;
      default:
        return PaymentSessionStatus.PENDING;
    }
  }

  async initiatePayment(
    input: InitiatePaymentInput
  ): Promise<InitiatePaymentOutput> {
    try {
      const { amount, currency_code, context } = input;
      const customer = context?.customer;
      const resourceId = input.data?.resource_id || input.data?.id || "";

      PhonePeBase.sequenceCount++;
      const merchantOrderId = `${resourceId}_${PhonePeBase.sequenceCount}`;

      // Convert amount to paisa (PhonePe expects amount in smallest currency unit)
      const amountInPaisa = Math.round(amount * 100);

      const paymentRequest: PaymentRequestV2 = {
        merchantOrderId,
        amount: amountInPaisa,
        expireAfter: 1800, // 30 minutes default
        paymentFlow: {
          type: "PG_CHECKOUT",
          message: "Payment for your order",
          merchantUrls: {
            redirectUrl: this.options_.redirectUrl,
          },
        },
        metaInfo: {
          udf1: customer?.id || "",
          udf2: customer?.email || "",
          udf3: resourceId,
        },
      };

      if (!this.phonepe_.validatePaymentRequestV2(paymentRequest)) {
        throw new Error("Invalid payment request");
      }

      this.logger.info(
        `Initiating payment: ${JSON.stringify({
          merchantOrderId,
          amount: amountInPaisa,
          currency_code,
        })}`
      );

      const response = await this.phonepe_.createPaymentV2(paymentRequest);

      if (this.options_.enabledDebugLogging) {
        this.logger.info(`Payment response: ${JSON.stringify(response)}`);
      }

      if (response.code !== "SUCCESS" && response.code !== "PAYMENT_INITIATED") {
        throw new Error(
          `Payment initiation failed: ${response.message || response.code}`
        );
      }

      const redirectUrl =
        response.data?.instrumentResponse?.redirectInfo?.url || "";

      return {
        id: merchantOrderId,
        data: {
          merchantOrderId,
          merchantTransactionId: response.data?.merchantTransactionId || merchantOrderId,
          redirectUrl,
          responseCode: response.code,
          responseMessage: response.message,
          ...response.data,
        },
      };
    } catch (error) {
      this.logger.error(`Error initiating payment: ${JSON.stringify(error)}`);
      const e = error as Error;
      return {
        error: "An error occurred while initiating payment",
        code: e.name || "INITIATE_PAYMENT_ERROR",
        detail: e.message || "",
      };
    }
  }

  async authorizePayment(
    input: AuthorizePaymentInput
  ): Promise<AuthorizePaymentOutput> {
    try {
      const merchantOrderId =
        input.data?.merchantOrderId || input.data?.merchantTransactionId;

      if (!merchantOrderId) {
        throw new Error("merchantOrderId is required");
      }

      this.logger.info(`Authorizing payment: ${merchantOrderId}`);

      // Check order status with retry logic
      const status = await this.checkAuthorisationWithBackOff(merchantOrderId);

      return {
        status,
        data: input.data || {},
      };
    } catch (error) {
      this.logger.error(`Error authorizing payment: ${JSON.stringify(error)}`);
      const e = error as Error;
      return {
        error: "An error occurred while authorizing payment",
        code: e.name || "AUTHORIZE_PAYMENT_ERROR",
        detail: e.message || "",
      };
    }
  }

  async checkAuthorisationWithBackOff(
    merchantOrderId: string
  ): Promise<PaymentSessionStatus> {
    try {
      return await this.retryFunction(merchantOrderId, 3000, 10);
    } catch (err) {
      if (isTooManyTries(err)) {
        try {
          return await this.retryFunction(merchantOrderId, 6000, 10);
        } catch (err) {
          if (isTooManyTries(err)) {
            try {
              return await this.retryFunction(merchantOrderId, 10000, 6);
            } catch (err) {
              if (isTooManyTries(err)) {
                try {
                  return await this.retryFunction(merchantOrderId, 30000, 2);
                } catch (err) {
                  if (isTooManyTries(err)) {
                    return await this.retryFunction(merchantOrderId, 60000, 15);
                  }
                  return PaymentSessionStatus.PENDING;
                }
              }
            }
          }
        }
      }
    }
    return PaymentSessionStatus.ERROR;
  }

  async retryFunction(
    merchantOrderId: string,
    delay: number,
    maxRetry: number
  ): Promise<PaymentSessionStatus> {
    return await retryAsync(
      async () => {
        const statusResponse = await this.phonepe_.getOrderStatusV2(
          merchantOrderId
        );

        if (this.options_.enabledDebugLogging) {
          this.logger.debug(
            `Order status response: ${JSON.stringify(statusResponse)}`
          );
        }

        const state = statusResponse.data?.state || "";
        const code = statusResponse.code || "";
        const paymentStatus = this.convertPaymentStatus(state, code);

        if (paymentStatus === PaymentSessionStatus.AUTHORIZED) {
          return paymentStatus;
        }

        // If still pending, throw to retry
        if (paymentStatus === PaymentSessionStatus.PENDING) {
          throw new Error("Payment still pending");
        }

        // If error or canceled, return immediately
        return paymentStatus;
      },
      {
        delay: delay,
        maxTry: maxRetry,
        until: (lastResult) => lastResult === PaymentSessionStatus.AUTHORIZED,
      }
    );
  }

  async capturePayment(
    input: CapturePaymentInput
  ): Promise<CapturePaymentOutput> {
    try {
      const merchantOrderId =
        input.data?.merchantOrderId || input.data?.merchantTransactionId;

      if (!merchantOrderId) {
        throw new Error("merchantOrderId is required");
      }

      this.logger.info(`Capturing payment: ${merchantOrderId}`);

      // Check order status to verify it's authorized
      const statusResponse = await this.phonepe_.getOrderStatusV2(
        merchantOrderId
      );

      const state = statusResponse.data?.state || "";
      const code = statusResponse.code || "";

      if (
        state.toUpperCase() !== "SUCCESS" &&
        code.toUpperCase() !== "SUCCESS"
      ) {
        throw new Error(
          `Payment not in success state: ${state || code}. Cannot capture.`
        );
      }

      return {
        data: {
          ...input.data,
          ...statusResponse.data,
          captured: true,
        },
      };
    } catch (error) {
      this.logger.error(`Error capturing payment: ${JSON.stringify(error)}`);
      const e = error as Error;
      return {
        error: "An error occurred while capturing payment",
        code: e.name || "CAPTURE_PAYMENT_ERROR",
        detail: e.message || "",
      };
    }
  }

  async cancelPayment(input: CancelPaymentInput): Promise<CancelPaymentOutput> {
    try {
      const merchantOrderId =
        input.data?.merchantOrderId || input.data?.merchantTransactionId;

      if (!merchantOrderId) {
        throw new Error("merchantOrderId is required");
      }

      this.logger.info(`Canceling payment: ${merchantOrderId}`);

      // PhonePe doesn't have a direct cancel API, so we check status
      // and mark as canceled if not already captured
      const statusResponse = await this.phonepe_.getOrderStatusV2(
        merchantOrderId
      );

      const state = statusResponse.data?.state || "";

      if (state.toUpperCase() === "SUCCESS") {
        throw new Error("Cannot cancel payment that has already succeeded");
      }

      return {
        data: {
          ...input.data,
          canceled: true,
          state: "CANCELLED",
        },
      };
    } catch (error) {
      this.logger.error(`Error canceling payment: ${JSON.stringify(error)}`);
      const e = error as Error;
      return {
        error: "An error occurred while canceling payment",
        code: e.name || "CANCEL_PAYMENT_ERROR",
        detail: e.message || "",
      };
    }
  }

  async refundPayment(input: RefundPaymentInput): Promise<RefundPaymentOutput> {
    try {
      const merchantOrderId =
        input.data?.merchantOrderId || input.data?.merchantTransactionId;
      const originalTransactionId =
        input.data?.originalTransactionId || merchantOrderId;

      if (!merchantOrderId || !originalTransactionId) {
        throw new Error("merchantOrderId and originalTransactionId are required");
      }

      // Convert amount to paisa
      const amountInPaisa = Math.round(input.amount * 100);

      const refundRequest: RefundRequestV2 = {
        merchantId: this.options_.merchantId,
        merchantRefundId: `${merchantOrderId}_refund_${Date.now()}`,
        originalTransactionId,
        amount: amountInPaisa,
        callbackUrl: `${this.options_.callbackUrl}/hooks/refund`,
      };

      this.logger.info(`Creating refund: ${JSON.stringify(refundRequest)}`);

      const response = await this.phonepe_.createRefundV2(refundRequest);

      if (this.options_.enabledDebugLogging) {
        this.logger.info(`Refund response: ${JSON.stringify(response)}`);
      }

      if (response.code !== "SUCCESS") {
        throw new Error(
          `Refund failed: ${response.message || response.code}`
        );
      }

      return {
        data: {
          ...input.data,
          refundId: response.data?.merchantRefundId,
          refundTransactionId: response.data?.transactionId,
          refundAmount: response.data?.amount / 100,
          refundState: response.data?.state,
          ...response.data,
        },
      };
    } catch (error) {
      this.logger.error(`Error refunding payment: ${JSON.stringify(error)}`);
      const e = error as Error;
      return {
        error: "An error occurred while refunding payment",
        code: e.name || "REFUND_PAYMENT_ERROR",
        detail: e.message || "",
      };
    }
  }

  async updatePayment(input: UpdatePaymentInput): Promise<UpdatePaymentOutput> {
    // PhonePe doesn't allow updating an ongoing payment, so we initiate a new one
    this.logger.info(
      `Update payment request: ${JSON.stringify({
        amount: input.amount,
        currency_code: input.currency_code,
      })}`
    );

    const initiateInput: InitiatePaymentInput = {
      amount: input.amount,
      currency_code: input.currency_code,
      context: input.context,
      data: input.data,
    };

    return await this.initiatePayment(initiateInput);
  }

  /**
   * Constructs PhonePe Webhook event
   */
  constructWebhookEvent(encodedData: string, signature: string): PhonePeEvent {
    try {
      const decodedBody = JSON.parse(
        typeof encodedData === "string" && encodedData.startsWith("{")
          ? encodedData
          : atob(encodedData)
      ) as PhonePeS2SResponse;

      if (
        this.phonepe_.validateWebhook(
          encodedData,
          signature,
          this.options_.salt
        )
      ) {
        return {
          event: decodedBody.code || "checkout.order.completed",
          id:
            decodedBody.data?.merchantTransactionId ||
            decodedBody.data?.merchantOrderId ||
            "unknown",
          data: {
            object: decodedBody,
          },
        };
      } else {
        return {
          event: PaymentStatusCodeValues.PAYMENT_ERROR,
          id: decodedBody.data?.merchantTransactionId || "error_id",
          data: {
            object: {
              error: "Webhook signature validation failed",
              code: "SIGNATURE_VALIDATION_FAILED",
              message: "error validating data",
            } as any,
          },
        };
      }
    } catch (error) {
      this.logger.error(`Error constructing webhook event: ${JSON.stringify(error)}`);
      return {
        event: PaymentStatusCodeValues.PAYMENT_ERROR,
        id: "error_id",
        data: {
          object: {
            error: "Failed to parse webhook data",
            code: "PARSE_ERROR",
            message: (error as Error).message || "",
          } as any,
        },
      };
    }
  }

  protected buildError(
    message: string,
    e: Error
  ): PaymentProviderError {
    return {
      error: message,
      code: e.name || "UNKNOWN_ERROR",
      detail: e.message || "",
    };
  }
}

export default PhonePeBase;
