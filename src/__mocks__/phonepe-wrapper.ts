import { PaymentSessionStatus } from "@medusajs/framework/types";
import {
  OrderStatusResponseV2,
  PaymentRequestV2,
  PaymentResponseV2,
  RefundRequestV2,
  RefundResponseV2,
} from "../types";

export class MockPhonePeWrapper {
  async generateOAuthToken(): Promise<string> {
    return "mock-access-token";
  }

  async getAuthToken(): Promise<string> {
    return "mock-access-token";
  }

  async createPaymentV2(
    payload: PaymentRequestV2
  ): Promise<PaymentResponseV2> {
    return {
      code: "SUCCESS",
      message: "Payment initiated successfully",
      data: {
        merchantId: payload.merchantId,
        merchantTransactionId: payload.merchantTransactionId,
        merchantOrderId: payload.merchantOrderId,
        instrumentResponse: {
          type: "PG_CHECKOUT",
          redirectInfo: {
            url: "https://merchant.phonepe.com/checkout?token=mock-token",
            method: "GET",
          },
        },
      },
    };
  }

  async getOrderStatusV2(
    merchantOrderId: string
  ): Promise<OrderStatusResponseV2> {
    return {
      code: "SUCCESS",
      message: "Order retrieved successfully",
      data: {
        merchantId: "test",
        merchantOrderId: merchantOrderId,
        merchantTransactionId: merchantOrderId,
        transactionId: `txn_${merchantOrderId}`,
        amount: 100000,
        state: "SUCCESS",
        responseCode: "SUCCESS",
        paymentInstrument: {
          type: "UPI",
        },
      },
    };
  }

  async createRefundV2(payload: RefundRequestV2): Promise<RefundResponseV2> {
    return {
      code: "SUCCESS",
      message: "Refund initiated successfully",
      data: {
        merchantId: payload.merchantId,
        merchantRefundId: payload.merchantRefundId,
        transactionId: `refund_txn_${payload.merchantRefundId}`,
        amount: payload.amount,
        state: "SUCCESS",
        responseCode: "SUCCESS",
      },
    };
  }

  validateWebhook(data: string, signature: string, salt: string): boolean {
    // Mock validation - return true for tests
    return true;
  }

  validatePaymentRequestV2(payload: PaymentRequestV2): boolean {
    return !!(
      payload.merchantId &&
      payload.merchantOrderId &&
      payload.amount &&
      payload.paymentFlow
    );
  }
}

