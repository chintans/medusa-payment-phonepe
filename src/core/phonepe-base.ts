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

import { setTimeout } from "node:timers/promises";
import type { Logger } from "@medusajs/framework/types";
import {
	AuthorizePaymentInput,
	AuthorizePaymentOutput,
	CancelPaymentInput,
	CancelPaymentOutput,
	CapturePaymentInput,
	CapturePaymentOutput,
	DeletePaymentInput,
	DeletePaymentOutput,
	GetPaymentStatusInput,
	GetPaymentStatusOutput,
	InitiatePaymentInput,
	InitiatePaymentOutput,
	ProviderWebhookPayload,
	RefundPaymentInput,
	RefundPaymentOutput,
	RetrievePaymentInput,
	RetrievePaymentOutput,
	UpdatePaymentInput,
	UpdatePaymentOutput,
	WebhookActionResult,
} from "@medusajs/framework/types";
import {
	AbstractPaymentProvider,
	isDefined,
	PaymentActions,
	PaymentSessionStatus,
} from "@medusajs/framework/utils";
import { OrderStatusResponse, PhonePeException } from "pg-sdk-node";
import {
	PaymentIntentOptions,
	PaymentStatusCodeValues,
	PhonePeEvent,
	PhonePeOptions,
	PhonePeS2SResponse,
} from "../types.js";
import {
	PhonePeWrapper,
	RefundInput,
	StandardPayInput,
} from "./phonepe-wrapper.js";

type PhonePeIndeterminateState = {
	indeterminate_due_to: string;
};

type PhonePeErrorData = OrderStatusResponse | PhonePeIndeterminateState;
type HandledErrorType =
	| { retry: true }
	| { retry: false; data: PhonePeErrorData };

export type TransactionIdentifier = {
	merchantId: string;
	merchantOrderId: string;
};

abstract class PhonePeBase extends AbstractPaymentProvider<PhonePeOptions> {
	static readonly identifier: string = "";
	static sequenceCount: number = 0;

	protected readonly options_: PhonePeOptions;
	protected phonepe_: PhonePeWrapper;
	protected logger: Logger;
	protected container_: Record<string, unknown>;

	static validateOptions(options: PhonePeOptions): void {
		if (!isDefined(options.clientId)) {
			throw new Error(
				"Required option `clientId` is missing in PhonePe plugin",
			);
		}
		if (!isDefined(options.clientSecret)) {
			throw new Error(
				"Required option `clientSecret` is missing in PhonePe plugin",
			);
		}
		if (!isDefined(options.redirectUrl)) {
			throw new Error(
				"Required option `redirectUrl` is missing in PhonePe plugin",
			);
		}
		if (!isDefined(options.callbackUrl)) {
			throw new Error(
				"Required option `callbackUrl` is missing in PhonePe plugin",
			);
		}
	}

	protected constructor(
		container: { logger: Logger } & Record<string, unknown>,
		options: PhonePeOptions,
	) {
		super(container, options);

		this.container_ = container;
		this.logger = container.logger;
		this.options_ = options;
		this.init();
	}

	protected init(): void {
		this.phonepe_ =
			this.phonepe_ ||
			new PhonePeWrapper(
				{
					...this.options_,
					callbackUrl: this.options_.callbackUrl ?? "http://localhost:9000",
				},
				this.logger,
			);
	}

	abstract get paymentIntentOptions(): PaymentIntentOptions;

	get options(): PhonePeOptions {
		return this.options_;
	}

	handlePhonePeError(error: any): HandledErrorType {
		// Check for network/connection errors (retryable)
		if (
			error?.code === "ECONNREFUSED" ||
			error?.code === "ETIMEDOUT" ||
			error?.code === "ENOTFOUND"
		) {
			return {
				retry: true,
			};
		}

		// Check for rate limiting (retryable)
		if (error?.status === 429 || error?.code === "RATE_LIMIT_ERROR") {
			return {
				retry: true,
			};
		}

		// Check for server errors (indeterminate - rely on webhooks)
		if (error?.status >= 500 && error?.status < 600) {
			return {
				retry: false,
				data: {
					indeterminate_due_to: "phonepe_server_error",
				},
			};
		}

		// For all other errors, there was likely an issue with the request
		// Return the error data if available, otherwise throw
		if (error?.data || error?.response) {
			return {
				retry: false,
				data: (error.data || error.response) as PhonePeErrorData,
			};
		}

		// Default: don't retry, but indicate indeterminate state
		return {
			retry: false,
			data: {
				indeterminate_due_to: "unknown_error",
			},
		};
	}

	async executeWithRetry<T>(
		apiCall: () => Promise<T>,
		maxRetries: number = 3,
		baseDelay: number = 1000,
		currentAttempt: number = 1,
	): Promise<T | PhonePeErrorData> {
		try {
			return await apiCall();
		} catch (error) {
			const handledError = this.handlePhonePeError(error);

			if (!handledError.retry) {
				// If retry is false, we know data exists per the type definition
				return handledError.data;
			}

			if (handledError.retry && currentAttempt <= maxRetries) {
				// Exponential backoff with jitter
				const delay =
					baseDelay *
					Math.pow(2, currentAttempt - 1) *
					(0.5 + Math.random() * 0.5);
				await setTimeout(delay);
				return this.executeWithRetry(
					apiCall,
					maxRetries,
					baseDelay,
					currentAttempt + 1,
				);
			}
			// Retries are exhausted
			throw this.buildError(
				"An error occurred during PhonePe API call",
				error as Error,
			);
		}
	}

	private getStatus(orderStatus: OrderStatusResponse): {
		data: OrderStatusResponse;
		status: PaymentSessionStatus;
	} {
		const state = orderStatus.state?.toUpperCase() || "";
		const code =
			orderStatus.errorCode?.toUpperCase() ||
			orderStatus.detailedErrorCode?.toUpperCase() ||
			"";

		switch (state || code) {
			case "COMPLETED":
			case "PAID":
			case "SUCCESS":
			case "PAYMENT_SUCCESS":
				return { status: PaymentSessionStatus.AUTHORIZED, data: orderStatus };
			case "PENDING":
			case "PAYMENT_PENDING":
			case "PAYMENT_INITIATED":
			case "CREATED":
			case "INITIATED":
				return { status: PaymentSessionStatus.PENDING, data: orderStatus };
			case "FAILED":
			case "PAYMENT_ERROR":
			case "PAYMENT_DECLINED":
			case "BAD_REQUEST":
			case "INTERNAL_SERVER_ERROR":
			case "AUTHORIZATION_FAILED":
				return { status: PaymentSessionStatus.ERROR, data: orderStatus };
			case "CANCELLED":
			case "PAYMENT_CANCELLED":
			case "TRANSACTION_NOT_FOUND":
				return { status: PaymentSessionStatus.CANCELED, data: orderStatus };
			default:
				return { status: PaymentSessionStatus.PENDING, data: orderStatus };
		}
	}

	async getPaymentStatus(
		input: GetPaymentStatusInput,
	): Promise<GetPaymentStatusOutput> {
		const id = input?.data?.id as string;
		const merchantOrderId = (input?.data?.merchantOrderId ||
			input?.data?.merchantTransactionId ||
			id) as string;

		if (!merchantOrderId || typeof merchantOrderId !== "string") {
			throw this.buildError(
				"No merchant order ID provided while getting payment status",
				new Error("No merchant order ID provided"),
			);
		}

		try {
			const orderStatus = await this.phonepe_.getOrderStatus(
				merchantOrderId,
				true,
			);
			const statusResponse = this.getStatus(orderStatus);

			return statusResponse as unknown as GetPaymentStatusOutput;
		} catch (error) {
			throw this.buildError(
				"An error occurred while getting payment status",
				error as Error,
			);
		}
	}

	async initiatePayment({
		currency_code,
		amount,
		data,
		context,
	}: InitiatePaymentInput): Promise<InitiatePaymentOutput> {
		try {
			const customer = context?.customer;
			const resourceId = (data?.resource_id || data?.id || "") as string;

			PhonePeBase.sequenceCount++;
			const merchantOrderId = `${resourceId}_${PhonePeBase.sequenceCount}`;

			const amountNumber = typeof amount === "number" ? amount : Number(amount);
			const paymentRequest: StandardPayInput = {
				merchantOrderId,
				amount: Number(amountNumber.toFixed(2)),
				expireAfter: 1800, // 30 minutes default
				redirectUrl: this.options_.redirectUrl,
				message: this.options_.payment_description || "Payment for your order",
				metaInfo: {
					udf1: customer?.id || "",
					udf2: customer?.email || "",
					udf3: resourceId,
					udf4: context?.idempotency_key || "",
				},
			};

			if (!this.phonepe_.validatePaymentInput(paymentRequest)) {
				throw new Error("Invalid payment request");
			}

			this.logger.info(
				`Initiating payment: ${JSON.stringify({
					merchantOrderId,
					amount: paymentRequest.amount,
					currency_code,
				})}`,
			);

			const response = await this.executeWithRetry(() =>
				this.phonepe_.createPayment(paymentRequest),
			);

			const isOrderStatusResponse =
				response &&
				typeof response === "object" &&
				"orderId" in response &&
				"redirectUrl" in response;
			if (this.options_.enabledDebugLogging) {
				this.logger.info(`Payment response: ${JSON.stringify(response)}`);
			}

			if (isOrderStatusResponse) {
				const paymentResponse = response as {
					orderId: string;
					redirectUrl: string;
					state?: string;
					expireAt?: number;
				};
				return {
					id: merchantOrderId,
					data: {
						merchantOrderId,
						orderId: paymentResponse.orderId,
						merchantTransactionId: paymentResponse.orderId,
						redirectUrl: paymentResponse.redirectUrl,
						state: paymentResponse.state,
						expireAt: paymentResponse.expireAt,
					},
				};
			} else {
				// Error or indeterminate state
				return {
					id: merchantOrderId,
					data: {
						merchantOrderId,
						state: "PENDING",
					},
				};
			}
		} catch (error) {
			this.logger.error(`Error initiating payment: ${JSON.stringify(error)}`);
			throw this.buildError(
				"An error occurred while initiating payment",
				error as Error,
			);
		}
	}

	async authorizePayment(
		input: AuthorizePaymentInput,
	): Promise<AuthorizePaymentOutput> {
		return this.getPaymentStatus(input);
	}

	async capturePayment({
		data,
		context: _context,
	}: CapturePaymentInput): Promise<CapturePaymentOutput> {
		const merchantOrderId = (data?.merchantOrderId ||
			data?.merchantTransactionId) as string;

		if (!merchantOrderId || typeof merchantOrderId !== "string") {
			throw this.buildError(
				"No merchant order ID provided while capturing payment",
				new Error("No merchant order ID provided"),
			);
		}

		try {
			const orderStatus = await this.phonepe_.getOrderStatus(
				merchantOrderId,
				true,
			);
			const state = orderStatus.state?.toUpperCase() || "";

			if (!["SUCCESS", "COMPLETED", "PAID"].includes(state)) {
				// Check if it's already captured
				if (state === "SUCCESS" || state === "COMPLETED" || state === "PAID") {
					return { data: orderStatus as unknown as Record<string, unknown> };
				}
				throw this.buildError(
					`Payment not in success state: ${
						state || "UNKNOWN"
					}. Cannot capture.`,
					new Error(`Payment state: ${state}`),
				);
			}

			return {
				data: {
					...data,
					orderId: orderStatus.orderId,
					merchantOrderId: orderStatus.merchantOrderId,
					merchantId: orderStatus.merchantId,
					amount: orderStatus.amount,
					paymentDetails: orderStatus.paymentDetails,
					captured: true,
				} as unknown as Record<string, unknown>,
			};
		} catch (error) {
			if (error instanceof Error && error.message.includes("success state")) {
				// Already handled
				throw error;
			}
			throw this.buildError(
				"An error occurred in capturePayment",
				error as Error,
			);
		}
	}

	async cancelPayment({
		data,
		context: _context,
	}: CancelPaymentInput): Promise<CancelPaymentOutput> {
		try {
			const merchantOrderId = (data?.merchantOrderId ||
				data?.merchantTransactionId) as string;

			if (!merchantOrderId || typeof merchantOrderId !== "string") {
				return { data: data || {} };
			}

			// PhonePe doesn't have a direct cancel API, so we check status
			// and mark as canceled if not already captured
			const orderStatus = await this.phonepe_.getOrderStatus(
				merchantOrderId,
				true,
			);
			const state = orderStatus.state?.toUpperCase() || "";

			if (["SUCCESS", "COMPLETED", "PAID"].includes(state)) {
				// Payment already succeeded, can't cancel
				return { data: orderStatus as unknown as Record<string, unknown> };
			}

			return {
				data: {
					...data,
					canceled: true,
					state: state || "CANCELLED",
				} as unknown as Record<string, unknown>,
			};
		} catch (error) {
			throw this.buildError(
				"An error occurred in cancelPayment",
				error as Error,
			);
		}
	}

	async deletePayment(input: DeletePaymentInput): Promise<DeletePaymentOutput> {
		return await this.cancelPayment(input);
	}

	async refundPayment({
		amount,
		data,
		context: _context,
	}: RefundPaymentInput): Promise<RefundPaymentOutput> {
		const merchantOrderId = (data?.merchantOrderId ||
			data?.merchantTransactionId) as string;
		const originalMerchantOrderId = (data?.originalTransactionId ||
			merchantOrderId) as string;

		if (!merchantOrderId || !originalMerchantOrderId) {
			throw this.buildError(
				"No merchant order ID provided while refunding payment",
				new Error("No merchant order ID provided"),
			);
		}

		try {
			const amountNumber = typeof amount === "number" ? amount : Number(amount);
			const refundInput: RefundInput = {
				merchantRefundId: `${merchantOrderId}_refund_${Date.now()}`,
				originalMerchantOrderId,
				amount: Number(amountNumber.toFixed(2)),
			};

			this.logger.info(`Creating refund: ${JSON.stringify(refundInput)}`);

			const response = await this.executeWithRetry(() =>
				this.phonepe_.refund(refundInput),
			);

			if (this.options_.enabledDebugLogging) {
				this.logger.info(`Refund response: ${JSON.stringify(response)}`);
			}

			const isRefundResponse =
				response &&
				typeof response === "object" &&
				"refundId" in response &&
				"amount" in response &&
				"state" in response;
			if (isRefundResponse) {
				const refundResponse = response as {
					refundId: string;
					amount: number;
					state: string;
				};
				return {
					data: {
						...data,
						refundId: refundResponse.refundId,
						refundAmount: refundResponse.amount,
						refundState: refundResponse.state,
					} as unknown as Record<string, unknown>,
				};
			} else {
				// Error or indeterminate state
				return { data: data || {} };
			}
		} catch (error) {
			throw this.buildError(
				"An error occurred in refundPayment",
				error as Error,
			);
		}
	}

	async retrievePayment({
		data,
	}: RetrievePaymentInput): Promise<RetrievePaymentOutput> {
		try {
			const merchantOrderId = (data?.merchantOrderId ||
				data?.merchantTransactionId) as string;

			if (!merchantOrderId || typeof merchantOrderId !== "string") {
				throw this.buildError(
					"No merchant order ID provided while retrieving payment",
					new Error("No merchant order ID provided"),
				);
			}

			const orderStatus = await this.phonepe_.getOrderStatus(
				merchantOrderId,
				true,
			);

			// Convert amount if needed (PhonePe returns amount in standard units)
			const amount = orderStatus.amount || 0;

			return {
				data: {
					...orderStatus,
					amount,
				} as unknown as Record<string, unknown>,
			};
		} catch (error) {
			throw this.buildError(
				"An error occurred in retrievePayment",
				error as Error,
			);
		}
	}

	async updatePayment({
		data,
		currency_code,
		amount,
		context,
	}: UpdatePaymentInput): Promise<UpdatePaymentOutput> {
		// PhonePe doesn't allow updating an ongoing payment, so we initiate a new one
		this.logger.info(
			`Update payment request: ${JSON.stringify({
				amount,
				currency_code,
			})}`,
		);

		const initiateInput: InitiatePaymentInput = {
			amount,
			currency_code,
			context,
			data,
		};

		return await this.initiatePayment(initiateInput);
	}

	async getWebhookActionAndData(
		webhookData: ProviderWebhookPayload["payload"],
	): Promise<WebhookActionResult> {
		// Extract authorization header and body from webhook payload
		const authorizationHeader =
			(webhookData.headers?.["authorization"] as string) ||
			(webhookData.headers?.["Authorization"] as string) ||
			(webhookData.headers?.["x-authorization"] as string) ||
			(webhookData.headers?.["X-Authorization"] as string) ||
			"";

		const callbackBody =
			typeof webhookData.rawData === "string"
				? webhookData.rawData
				: JSON.stringify(webhookData.rawData);

		const event = await this.constructWebhookEvent(
			authorizationHeader,
			callbackBody,
		);

		const paymentData = event.data.object;
		const payload = paymentData?.data || (paymentData as any)?.data?.data || {};

		const merchantOrderId =
			payload.merchantOrderId ||
			(payload.merchantTransactionId as string | undefined) ||
			((payload as any).orderId as string | undefined) ||
			event.id;

		const amount = payload.amount || 0;
		const state = payload.state?.toUpperCase() || "";
		const code = paymentData?.code || event.event || "";
		const eventType: string = code || event.event;

		if (
			eventType === "checkout.order.completed" ||
			eventType === PaymentStatusCodeValues.PAYMENT_SUCCESS ||
			eventType === PaymentStatusCodeValues.SUCCESS ||
			eventType === "PG_ORDER_COMPLETED"
		) {
			return {
				action: PaymentActions.SUCCESSFUL,
				data: {
					session_id: merchantOrderId,
					amount,
				},
			};
		}

		if (
			eventType === "checkout.order.failed" ||
			eventType === PaymentStatusCodeValues.PAYMENT_ERROR ||
			eventType === PaymentStatusCodeValues.PAYMENT_DECLINED ||
			eventType === "PG_ORDER_FAILED"
		) {
			return {
				action: PaymentActions.FAILED,
				data: {
					session_id: merchantOrderId,
					amount,
				},
			};
		}

		if (
			eventType === "pg.refund.completed" ||
			eventType === "PG_REFUND_COMPLETED"
		) {
			// PhonePe refund completed - use SUCCESSFUL action for refunds
			return {
				action: PaymentActions.SUCCESSFUL,
				data: {
					session_id: merchantOrderId,
					amount,
				},
			};
		}

		if (eventType === "pg.refund.failed" || eventType === "PG_REFUND_FAILED") {
			return {
				action: PaymentActions.FAILED,
				data: {
					session_id: merchantOrderId,
					amount,
				},
			};
		}
		// Check state for pending/authorized
		if (
			state === "PENDING" ||
			state === "PAYMENT_PENDING" ||
			state === "PAYMENT_INITIATED"
		) {
			return {
				action: PaymentActions.PENDING,
				data: {
					session_id: merchantOrderId,
					amount,
				},
			};
		}
		if (state === "SUCCESS" || state === "COMPLETED" || state === "PAID") {
			return {
				action: PaymentActions.SUCCESSFUL,
				data: {
					session_id: merchantOrderId,
					amount,
				},
			};
		}
		return { action: PaymentActions.NOT_SUPPORTED };
	}

	/**
	 * Constructs PhonePe Webhook event using SDK validation
	 * @param authorizationHeader
	 * @param callbackBody
	 */
	async constructWebhookEvent(
		authorizationHeader: string,
		callbackBody: string,
	): Promise<PhonePeEvent> {
		try {
			// Try SDK validation first
			const callbackResponse = await this.phonepe_.validateWebhookCallback(
				authorizationHeader,
				callbackBody,
			);

			if (callbackResponse) {
				// SDK validation succeeded - use the validated callback response
				const payload = callbackResponse.payload || {};
				const eventType = this.mapCallbackTypeToEventType(
					callbackResponse.type,
				);

				return {
					event: eventType,
					id:
						payload.merchantOrderId ||
						payload.orderId ||
						payload.merchantTransactionId ||
						"unknown",
					data: {
						object: {
							code: callbackResponse.type,
							message: "Webhook validated successfully",
							data: {
								merchantOrderId: payload.merchantOrderId,
								merchantTransactionId:
									payload.merchantTransactionId || payload.orderId,
								orderId: payload.orderId,
								state: payload.state,
								amount: payload.amount,
								paymentDetails: payload.paymentDetails,
								paymentInstrument: payload.paymentInstrument,
							},
						} as any,
					},
				};
			}

			// Fallback to legacy validation if SDK validation is not available
			this.logger.warn(
				"SDK webhook validation not available, falling back to legacy validation",
			);
			return await this.buildLegacyWebhookEvent(
				callbackBody,
				authorizationHeader,
			);
		} catch (error) {
			this.logger.error(
				`Error constructing webhook event: ${JSON.stringify(error)}`,
			);

			// Try to parse the body for error details
			try {
				const parsedBody = JSON.parse(callbackBody);
				return {
					event: PaymentStatusCodeValues.PAYMENT_ERROR,
					id:
						parsedBody.payload?.merchantOrderId ||
						parsedBody.payload?.orderId ||
						"error_id",
					data: {
						object: {
							error: "Webhook validation failed",
							code: "VALIDATION_ERROR",
							message: (error as Error).message || "",
							data: parsedBody.payload,
						} as any,
					},
				};
			} catch {
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
	}

	/**
	 * Maps PhonePe callback type to event type
	 * @param callbackType
	 */
	private mapCallbackTypeToEventType(callbackType: string): string {
		const typeMap: Record<string, string> = {
			PG_ORDER_COMPLETED: "checkout.order.completed",
			PG_ORDER_FAILED: "checkout.order.failed",
			PG_REFUND_COMPLETED: "pg.refund.completed",
			PG_REFUND_FAILED: "pg.refund.failed",
		};

		return typeMap[callbackType] || callbackType || "checkout.order.completed";
	}

	/**
	 * Legacy webhook event construction (fallback)
	 * Uses legacy validation when SDK validation is unavailable.
	 * @param encodedData
	 * @param authorizationHeader
	 */
	private async buildLegacyWebhookEvent(
		encodedData: string,
		authorizationHeader: string,
	): Promise<PhonePeEvent> {
		try {
			const decodedBody = JSON.parse(
				typeof encodedData === "string" && encodedData.startsWith("{")
					? encodedData
					: atob(encodedData),
			) as PhonePeS2SResponse;

			// Try to use the new validation method if possible
			const callbackResponse = await this.phonepe_.validateWebhookCallback(
				authorizationHeader,
				encodedData,
			);

			if (callbackResponse) {
				// New validation succeeded
				const payload = callbackResponse.payload || {};
				const eventType = this.mapCallbackTypeToEventType(
					callbackResponse.type,
				);

				return {
					event: eventType,
					id:
						payload.merchantOrderId ||
						payload.orderId ||
						payload.merchantTransactionId ||
						decodedBody.data?.merchantTransactionId ||
						decodedBody.data?.merchantOrderId ||
						"unknown",
					data: {
						object: {
							code: callbackResponse.type,
							message: "Webhook validated successfully",
							data: {
								merchantOrderId: payload.merchantOrderId,
								merchantTransactionId:
									payload.merchantTransactionId || payload.orderId,
								orderId: payload.orderId,
								state: payload.state,
								amount: payload.amount,
								paymentDetails: payload.paymentDetails,
								paymentInstrument: payload.paymentInstrument,
							},
						} as any,
					},
				};
			}

			// If new validation is not available, proceed without validation
			// (the old deprecated method didn't actually validate properly)
			this.logger.warn(
				"Legacy webhook validation: proceeding without signature validation",
			);

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
		} catch (error: unknown) {
			this.logger.error(
				`Error constructing webhook event (legacy): ${JSON.stringify(error)}`,
			);
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

	protected buildError(message: string, error: Error): Error {
		// Remove reliance on PaymentProviderError, which isn't defined
		// Instead, safely check if 'detail' property exists
		const errorDetails =
			"errorContext" in error
				? (error.errorContext as PhonePeException)
				: error;

		return new Error(
			`${message}: ${error.message}. ${
				"cause" in errorDetails ? errorDetails.cause : ""
			}`.trim(),
		);
	}
}

export default PhonePeBase;
