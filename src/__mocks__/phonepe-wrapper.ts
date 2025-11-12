import { RefundInput, StandardPayInput } from "../core/phonepe-wrapper";

type MockCallbackPayload = {
	orderId: string;
	merchantOrderId: string;
	merchantTransactionId?: string;
	state: string;
	amount: number;
};

export class MockPhonePeWrapper {
	async createPayment(payload: StandardPayInput) {
		return {
			orderId: `order_${payload.merchantOrderId}`,
			state: "SUCCESS",
			expireAt: Date.now() + 1800,
			redirectUrl: "https://merchant.phonepe.com/checkout?token=mock-token",
		};
	}

	async getOrderStatus(merchantOrderId: string) {
		return {
			orderId: `order_${merchantOrderId}`,
			merchantOrderId,
			merchantId: "test",
			amount: 100,
			state: "COMPLETED",
			paymentDetails: [
				{
					state: "COMPLETED",
				},
			],
		};
	}

	async refund(payload: RefundInput) {
		return {
			refundId: payload.merchantRefundId,
			amount: payload.amount,
			state: "SUCCESS",
		};
	}

	async validateWebhookCallback(
		authorizationHeader: string,
		callbackBody: string,
	): Promise<{ type: string; payload: MockCallbackPayload } | null> {
		if (!authorizationHeader) {
			return null;
		}

		try {
			const parsedBody = JSON.parse(callbackBody);
			return {
				type: parsedBody.type || "PG_ORDER_COMPLETED",
				payload: parsedBody.payload || {
					orderId: "mock_order_id",
					merchantOrderId: "mock_merchant_order_id",
					merchantTransactionId: "mock_merchant_transaction_id",
					state: "COMPLETED",
					amount: 100,
				},
			};
		} catch {
			return {
				type: "PG_ORDER_COMPLETED",
				payload: {
					orderId: "mock_order_id",
					merchantOrderId: "mock_merchant_order_id",
					merchantTransactionId: "mock_merchant_transaction_id",
					state: "COMPLETED",
					amount: 100,
				},
			};
		}
	}

	validateWebhook(): boolean {
		return true;
	}

	validatePaymentInput(payload: StandardPayInput): boolean {
		return !!(payload.merchantOrderId && payload.amount && payload.redirectUrl);
	}
}
