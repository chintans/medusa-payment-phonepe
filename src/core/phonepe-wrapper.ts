import axios, { AxiosResponse } from "axios";
import {
  PhonePeOptions,
  OAuthTokenResponse,
  OAuthTokenCache,
  PaymentRequestV2,
  PaymentResponseV2,
  OrderStatusResponseV2,
  RefundRequestV2,
  RefundResponseV2,
  PaymentStatusCodeValues,
} from "../types";
import { Logger } from "@medusajs/framework/utils";

export class PhonePeWrapper {
  options: PhonePeOptions;
  url: string;
  logger: Logger | Console;
  private tokenCache: OAuthTokenCache | null = null;

  constructor(options: PhonePeOptions, logger?: Logger) {
    this.logger = logger ?? console;
    this.options = options;
    switch (this.options.mode) {
      case "production":
        this.url = "https://api.phonepe.com/apis";
        break;
      case "uat":
        this.url = "https://api-preprod.phonepe.com/apis";
        break;
      case "test":
      default:
        this.url = "https://api-preprod.phonepe.com/apis/pg-sandbox";
        break;
    }
  }

  /**
   * Generate OAuth token for PhonePe API authentication
   */
  async generateOAuthToken(): Promise<string> {
    // Check if cached token is still valid
    if (
      this.tokenCache &&
      this.options.tokenCacheEnabled !== false &&
      this.tokenCache.expiresAt > Date.now()
    ) {
      this.logger.debug("Using cached OAuth token");
      return this.tokenCache.token;
    }

    try {
      const authUrl = `${this.url}/v1/oauth/token`;
      const credentials = Buffer.from(
        `${this.options.clientId}:${this.options.clientSecret}`
      ).toString("base64");

      const response = await axios.post<OAuthTokenResponse>(
        authUrl,
        {
          grant_type: "client_credentials",
        },
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Basic ${credentials}`,
          },
        }
      );

      const tokenData = response.data;
      const expiresAt = Date.now() + (tokenData.expires_in - 300) * 1000; // Refresh 5 minutes before expiry

      // Cache the token
      this.tokenCache = {
        token: tokenData.access_token,
        expiresAt,
      };

      this.logger.debug("OAuth token generated and cached");
      return tokenData.access_token;
    } catch (error) {
      this.logger.error(`Failed to generate OAuth token: ${JSON.stringify(error)}`);
      throw new Error("Failed to generate OAuth token for PhonePe API");
    }
  }

  /**
   * Get OAuth token (generate if needed)
   */
  async getAuthToken(): Promise<string> {
    return await this.generateOAuthToken();
  }

  /**
   * Create payment request using PhonePe v2 API
   */
  async createPaymentV2(
    payload: PaymentRequestV2
  ): Promise<PaymentResponseV2> {
    try {
      const token = await this.getAuthToken();
      const apiEndpoint = "/checkout/v2/pay";
      const url = `${this.url}${apiEndpoint}`;

      const headers = {
        "Content-Type": "application/json",
        Authorization: `O-Bearer ${token}`,
      };

      const response = await axios.post<PaymentResponseV2>(url, payload, {
        headers,
      });

      if (this.options.enabledDebugLogging) {
        this.logger.info(
          `PhonePe payment response: ${JSON.stringify(response.data)}`
        );
      }

      return response.data;
    } catch (error: any) {
      this.logger.error(
        `Failed to create payment: ${JSON.stringify(error.response?.data || error.message)}`
      );
      throw error;
    }
  }

  /**
   * Get order status using PhonePe v2 API
   */
  async getOrderStatusV2(
    merchantOrderId: string
  ): Promise<OrderStatusResponseV2> {
    if (!merchantOrderId) {
      throw new Error("merchantOrderId is required");
    }

    try {
      const token = await this.getAuthToken();
      const apiEndpoint = `/checkout/v2/order/${merchantOrderId}/status`;
      const url = `${this.url}${apiEndpoint}`;

      const headers = {
        "Content-Type": "application/json",
        Authorization: `O-Bearer ${token}`,
      };

      const response = await axios.get<OrderStatusResponseV2>(url, {
        headers,
      });

      if (this.options.enabledDebugLogging) {
        this.logger.info(
          `PhonePe order status response: ${JSON.stringify(response.data)}`
        );
      }

      return response.data;
    } catch (error: any) {
      this.logger.error(
        `Failed to get order status: ${JSON.stringify(error.response?.data || error.message)}`
      );
      throw error;
    }
  }

  /**
   * Create refund request using PhonePe v2 API
   */
  async createRefundV2(
    payload: RefundRequestV2
  ): Promise<RefundResponseV2> {
    try {
      const token = await this.getAuthToken();
      const apiEndpoint = "/checkout/v2/refund";
      const url = `${this.url}${apiEndpoint}`;

      const headers = {
        "Content-Type": "application/json",
        Authorization: `O-Bearer ${token}`,
      };

      const response = await axios.post<RefundResponseV2>(url, payload, {
        headers,
      });

      if (this.options.enabledDebugLogging) {
        this.logger.info(
          `PhonePe refund response: ${JSON.stringify(response.data)}`
        );
      }

      return response.data;
    } catch (error: any) {
      this.logger.error(
        `Failed to create refund: ${JSON.stringify(error.response?.data || error.message)}`
      );
      throw error;
    }
  }

  /**
   * Validate payment request
   */
  validatePaymentRequestV2(paymentRequest: PaymentRequestV2): boolean {
    if (!paymentRequest.merchantOrderId || paymentRequest.merchantOrderId.length === 0) {
      return false;
    }

    if (typeof paymentRequest.amount !== "number" || paymentRequest.amount <= 0) {
      return false;
    }

    if (!paymentRequest.paymentFlow || paymentRequest.paymentFlow.type !== "PG_CHECKOUT") {
      return false;
    }

    if (!paymentRequest.paymentFlow.merchantUrls?.redirectUrl) {
      return false;
    }

    if (paymentRequest.expireAfter) {
      if (paymentRequest.expireAfter < 300 || paymentRequest.expireAfter > 3600) {
        return false;
      }
    }

    return true;
  }

  /**
   * Legacy methods for backward compatibility (deprecated)
   */
  async postPaymentRequestToPhonePe(
    payload: any,
    apiNewEndpoint?: string
  ): Promise<any> {
    this.logger.warn(
      "postPaymentRequestToPhonePe is deprecated. Use createPaymentV2 instead."
    );
    // This method is kept for backward compatibility but should not be used
    throw new Error(
      "Legacy payment method is deprecated. Please use createPaymentV2."
    );
  }

  async getPhonePeTransactionStatus(
    merchantId: string,
    merchantTransactionId: string,
    apiNewEndpoint?: string
  ): Promise<any> {
    this.logger.warn(
      "getPhonePeTransactionStatus is deprecated. Use getOrderStatusV2 instead."
    );
    // For backward compatibility, try to use merchantTransactionId as merchantOrderId
    return await this.getOrderStatusV2(merchantTransactionId);
  }

  async postRefundRequestToPhonePe(
    payload: any,
    apiNewEndpoint?: string
  ): Promise<any> {
    this.logger.warn(
      "postRefundRequestToPhonePe is deprecated. Use createRefundV2 instead."
    );
    // Convert legacy refund request to v2 format
    const refundRequestV2: RefundRequestV2 = {
      merchantId: payload.merchantId,
      merchantRefundId: payload.merchantTransactionId,
      originalTransactionId: payload.originalTransactionId,
      amount: payload.amount,
      callbackUrl: payload.callbackUrl,
    };
    return await this.createRefundV2(refundRequestV2);
  }

  /**
   * Validate webhook signature (legacy method - may need updates for v2)
   */
  validateWebhook(data: string, signature: string, salt: string): boolean {
    // Webhook validation may have changed in v2 API
    // This is a placeholder - actual implementation depends on PhonePe v2 webhook format
    this.logger.warn(
      "validateWebhook may need updates for PhonePe v2 API webhook format"
    );
    // For now, return true if signature exists (implement proper validation)
    return !!signature;
  }
}
