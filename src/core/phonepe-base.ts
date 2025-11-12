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

import { randomUUID } from "node:crypto";
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
	static readonly STATUS_CACHE_TTL_MS = 5_000;

	protected readonly options_: PhonePeOptions;
	protected phonepe_: PhonePeWrapper;
	protected logger: Logger;
	protected container_: Record<string, unknown>;
	private readonly statusCache = new Map<
		string,
		{ data: OrderStatusResponse; expiresAt: number }
	>();
	private readonly inFlightStatusRequests = new Map<
		string,
		Promise<OrderStatusResponse>
	>();

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
		PhonePeBase.validateOptions(options);
		super(container, options);

		this.container_ = container;
		this.logger = container.logger;
		this.options_ = { ...options };
		this.init();
	}

	protected init(): void {
		if (!this.phonepe_) {
			this.ensureValidUrl(this.options_.redirectUrl, "redirectUrl");
			this.ensureValidUrl(this.options_.callbackUrl, "callbackUrl");
			this.phonepe_ = new PhonePeWrapper({ ...this.options_ }, this.logger);
		}
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
	): Promise<T | PhonePeErrorData> {
		let attempt = 1;
		for (;;) {
			try {
				return await apiCall();
			} catch (error) {
				const handledError = this.handlePhonePeError(error);

				if (!handledError.retry) {
					return handledError.data;
				}

				if (attempt >= maxRetries) {
					throw this.buildError(
						"An error occurred during PhonePe API call",
						error as Error,
					);
				}

				const delay =
					baseDelay * Math.pow(2, attempt - 1) * (0.5 + Math.random() * 0.5);
				await setTimeout(delay);
				attempt++;
			}
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

	private async getOrderStatusWithCache(
		merchantOrderId: string,
		withDetails: boolean = true,
	): Promise<OrderStatusResponse> {
		const cacheEntry = this.statusCache.get(merchantOrderId);
		const now = Date.now();

		if (cacheEntry && cacheEntry.expiresAt > now) {
			return cacheEntry.data;
		} else if (cacheEntry && cacheEntry.expiresAt <= now) {
			this.statusCache.delete(merchantOrderId);
		}

		const inFlightKey = `${merchantOrderId}:${withDetails}`;
		const existingRequest = this.inFlightStatusRequests.get(inFlightKey);
		if (existingRequest) {
			return existingRequest;
		}

		const request = this.phonepe_
			.getOrderStatus(merchantOrderId, withDetails)
			.then((response) => {
				this.statusCache.set(merchantOrderId, {
					data: response,
					expiresAt: Date.now() + PhonePeBase.STATUS_CACHE_TTL_MS,
				});
				return response;
			})
			.finally(() => {
				this.inFlightStatusRequests.delete(inFlightKey);
			});

		this.inFlightStatusRequests.set(inFlightKey, request);
		return request;
	}

	async getPaymentStatus(
		input: GetPaymentStatusInput,
	): Promise<GetPaymentStatusOutput> {
		try {
			const merchantOrderId = this.resolveMerchantOrderId(
				[
					input?.data?.merchantOrderId,
					input?.data?.merchantTransactionId,
					input?.data?.id,
				],
				"get payment status",
			);

			const orderStatus = await this.getOrderStatusWithCache(
				merchantOrderId,
				true,
			);
			const statusResponse = this.getStatus(orderStatus);

			return statusResponse as unknown as GetPaymentStatusOutput;
		} catch (error) {
			// Preserve validation errors without wrapping
			if (
				error instanceof Error &&
				error.message.includes("No merchant order ID provided")
			) {
				throw error;
			}
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
			const resourceId = this.normalizeResourceId(
				(data?.resource_id || data?.id) as string | undefined,
			);
			const merchantOrderId = this.createMerchantOrderId(resourceId);
			const normalizedAmount = this.normalizeAmount(amount, "amount");

			const paymentRequest: StandardPayInput = {
				merchantOrderId,
				amount: normalizedAmount,
				expireAfter: 1800, // 30 minutes default
				redirectUrl: this.options_.redirectUrl,
				message: this.options_.payment_description || "Payment for your order",
				metaInfo: this.compactMetaInfo({
					udf1: this.sanitizeMetaValue(customer?.id),
					udf2: this.sanitizeMetaValue(customer?.email),
					udf3: resourceId,
					udf4: this.sanitizeMetaValue(context?.idempotency_key),
				}),
			};

			if (!this.phonepe_.validatePaymentInput(paymentRequest)) {
				throw new Error("Invalid payment request");
			}

			this.logInfo("Initiating payment", {
				merchantOrderId,
				amount: paymentRequest.amount,
				currency_code,
			});

			const response = await this.executeWithRetry(() =>
				this.phonepe_.createPayment(paymentRequest),
			);

			const isOrderStatusResponse =
				response &&
				typeof response === "object" &&
				"orderId" in response &&
				"redirectUrl" in response;
			if (this.options_.enabledDebugLogging) {
				this.logInfo("Payment response received", {
					merchantOrderId,
					response: isOrderStatusResponse
						? this.redactSensitiveData(response)
						: this.maskValue("non_standard_response"),
				});
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
			this.logError("Error initiating payment", error);
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
		try {
			const merchantOrderId = this.resolveMerchantOrderId(
				[data?.merchantOrderId, data?.merchantTransactionId],
				"capture payment",
			);

			const orderStatus = await this.getOrderStatusWithCache(
				merchantOrderId,
				true,
			);
			const state = orderStatus.state?.toUpperCase() || "";

			if (!["SUCCESS", "COMPLETED", "PAID"].includes(state)) {
				throw this.buildError(
					`Payment not in success state: ${state || "UNKNOWN"}. Cannot capture.`,
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
			const merchantOrderId = this.resolveMerchantOrderId(
				[data?.merchantOrderId, data?.merchantTransactionId],
				"cancel payment",
				false,
			);

			if (!merchantOrderId) {
				return { data: data || {} };
			}

			// PhonePe doesn't have a direct cancel API, so we check status
			// and mark as canceled if not already captured
			const orderStatus = await this.getOrderStatusWithCache(
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
		try {
			const merchantOrderId = this.resolveMerchantOrderId(
				[data?.merchantOrderId, data?.merchantTransactionId],
				"refund payment",
			);
			const originalMerchantOrderId = this.resolveMerchantOrderId(
				[data?.originalTransactionId, merchantOrderId],
				"refund payment",
			);

			const normalizedAmount = this.normalizeAmount(amount, "refundAmount");
			const refundInput: RefundInput = {
				merchantRefundId: this.createRefundId(merchantOrderId),
				originalMerchantOrderId,
				amount: normalizedAmount,
			};

			this.logInfo("Creating refund", {
				merchantOrderId,
				originalMerchantOrderId,
			});

			const response = await this.executeWithRetry(() =>
				this.phonepe_.refund(refundInput),
			);

			if (this.options_.enabledDebugLogging) {
				this.logInfo("Refund response received", {
					merchantOrderId,
					response: this.redactSensitiveData(
						response as Record<string, unknown>,
					),
				});
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
			const merchantOrderId = this.resolveMerchantOrderId(
				[data?.merchantOrderId, data?.merchantTransactionId],
				"retrieve payment",
			);

			const orderStatus = await this.getOrderStatusWithCache(
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
		this.logInfo("Update payment request", {
			amount,
			currency_code,
		});

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
		if (!authorizationHeader) {
			throw this.buildError(
				"Missing authorization header for webhook validation",
				new Error("Authorization header is required"),
			);
		}

		try {
			// Try SDK validation first
			const callbackResponse = await this.phonepe_.validateWebhookCallback(
				authorizationHeader,
				callbackBody,
			);

			if (!callbackResponse) {
				throw this.buildError(
					"Webhook validation failed",
					new Error("PhonePe SDK did not validate callback"),
				);
			}

			// SDK validation succeeded - use the validated callback response
			const payload = callbackResponse.payload || {};
			const eventType = this.mapCallbackTypeToEventType(callbackResponse.type);

			return {
				event: eventType,
				id:
					payload.merchantOrderId ||
					payload.orderId ||
					payload.merchantTransactionId ||
					callbackResponse.id ||
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
		} catch (error) {
			this.logError("Error constructing webhook event", error);

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
							data: this.redactSensitiveData(parsedBody.payload) as any,
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

	protected buildError(message: string, error: Error): Error {
		// Remove reliance on PaymentProviderError, which isn't defined
		// Instead, safely check if 'detail' property exists
		const errorDetails =
			"errorContext" in error
				? (error.errorContext as PhonePeException)
				: error;

		const cause =
			typeof errorDetails === "object" &&
			errorDetails !== null &&
			"cause" in errorDetails &&
			typeof (errorDetails as PhonePeException).cause === "string"
				? (errorDetails as PhonePeException).cause
				: undefined;

		const sanitizedMessage = [message, error.message, cause]
			.filter((part) => typeof part === "string" && part.trim().length > 0)
			.join(": ");

		return new Error(sanitizedMessage);
	}

	private resolveMerchantOrderId(
		candidates: Array<unknown>,
		action: string,
		required: boolean = true,
	): string {
		for (const candidate of candidates) {
			if (typeof candidate === "string" && candidate.trim().length > 0) {
				return this.ensureValidMerchantOrderId(candidate, action);
			}
		}

		if (required) {
			// Use a simple error message that matches test expectations
			// Convert "get payment status" to "getting payment status" for better readability
			const actionText = action.replace(/^get /, "getting ");
			throw new Error(`No merchant order ID provided while ${actionText}`);
		}

		return "";
	}

	private ensureValidMerchantOrderId(value: string, action: string): string {
		const trimmed = value.trim();

		if (!trimmed) {
			throw this.buildError(
				`Invalid merchant order ID while attempting to ${action}`,
				new Error("Merchant order ID is empty"),
			);
		}

		if (trimmed.length > 50) {
			throw this.buildError(
				`Invalid merchant order ID while attempting to ${action}`,
				new Error("Merchant order ID exceeds 50 characters"),
			);
		}

		if (!/^[A-Za-z0-9._-]+$/.test(trimmed)) {
			throw this.buildError(
				`Invalid merchant order ID while attempting to ${action}`,
				new Error("Merchant order ID contains unsupported characters"),
			);
		}

		return trimmed;
	}

	private normalizeAmount(value: unknown, field: string): number {
		const numericValue =
			typeof value === "number" ? value : Number(value ?? Number.NaN);

		if (!Number.isFinite(numericValue)) {
			throw this.buildError(
				`Invalid ${field} provided`,
				new Error("Amount is not a finite number"),
			);
		}

		if (numericValue <= 0) {
			throw this.buildError(
				`Invalid ${field} provided`,
				new Error("Amount must be greater than zero"),
			);
		}

		return this.roundToTwoDecimals(numericValue);
	}

	private roundToTwoDecimals(value: number): number {
		return Math.round(value * 100) / 100;
	}

	private normalizeResourceId(resourceId?: string): string | undefined {
		if (!resourceId) {
			return undefined;
		}

		const trimmed = resourceId.trim();
		if (!trimmed) {
			return undefined;
		}

		const sanitized = trimmed.replaceAll(/[^A-Za-z0-9._-]/g, "").slice(0, 20);
		return sanitized || undefined;
	}

	private createMerchantOrderId(resourceId?: string): string {
		const uuidSegment = randomUUID().replaceAll("-", "").slice(0, 16);

		if (!resourceId) {
			return uuidSegment;
		}

		const base = resourceId.slice(0, 20);
		const candidate = `${base}-${uuidSegment}`;
		return candidate.length > 50 ? candidate.slice(0, 50) : candidate;
	}

	private createRefundId(merchantOrderId: string): string {
		const timestampSegment = Date.now().toString(36);
		const uuidSegment = randomUUID().replaceAll("-", "").slice(0, 8);
		const candidate = `${merchantOrderId}-${timestampSegment}${uuidSegment}`;
		return candidate.length > 50 ? candidate.slice(0, 50) : candidate;
	}

	private sanitizeMetaValue(value: unknown): string | undefined {
		if (value === null || value === undefined) {
			return undefined;
		}

		let stringValue: string | undefined;
		if (typeof value === "string") {
			stringValue = value;
		} else if (
			typeof value === "number" ||
			typeof value === "bigint" ||
			typeof value === "boolean"
		) {
			stringValue = String(value);
		} else if (value instanceof Date) {
			stringValue = value.toISOString();
		} else {
			return undefined;
		}

		const trimmed = stringValue.trim();
		if (!trimmed) {
			return undefined;
		}

		return trimmed.slice(0, 50);
	}

	private compactMetaInfo(
		metaInfo: StandardPayInput["metaInfo"],
	): StandardPayInput["metaInfo"] | undefined {
		if (!metaInfo) {
			return undefined;
		}

		const compactedEntries = Object.entries(metaInfo).filter(
			([, value]) => value !== undefined && value !== "",
		);

		if (compactedEntries.length === 0) {
			return undefined;
		}

		return Object.fromEntries(compactedEntries);
	}

	private maskValue(value: unknown): string {
		let rawValue = "";
		if (typeof value === "string") {
			rawValue = value;
		} else if (typeof value === "number" || typeof value === "bigint") {
			rawValue = String(value);
		} else if (typeof value === "boolean") {
			rawValue = value ? "true" : "false";
		} else if (value instanceof Date) {
			rawValue = value.toISOString();
		} else if (value) {
			try {
				rawValue = JSON.stringify(value);
			} catch {
				rawValue = "";
			}
		}

		if (!rawValue) {
			return "";
		}

		if (rawValue.length <= 6) {
			return `${rawValue.slice(0, 1)}***${rawValue.slice(-1)}`;
		}

		return `${rawValue.slice(0, 4)}***${rawValue.slice(-4)}`;
	}

	private redactSensitiveData(data: unknown): unknown {
		if (!data || typeof data !== "object") {
			return data;
		}

		if (Array.isArray(data)) {
			return data.map((item) => this.redactSensitiveData(item));
		}

		const sensitiveKeys = new Set([
			"merchantOrderId",
			"merchantTransactionId",
			"orderId",
			"refundId",
			"paymentInstrument",
			"paymentDetails",
			"clientSecret",
			"access_token",
			"token",
			"authorization",
		]);

		return Object.fromEntries(
			Object.entries(data as Record<string, unknown>).map(([key, value]) => {
				if (sensitiveKeys.has(key)) {
					return [key, this.maskValue(value)];
				}

				if (typeof value === "object" && value !== null) {
					return [key, this.redactSensitiveData(value)];
				}

				return [key, value];
			}),
		);
	}

	private formatLogData(data: Record<string, unknown>): string {
		const redacted = this.redactSensitiveData(data) as Record<string, unknown>;

		return Object.entries(redacted)
			.map(([key, value]) => `${key}=${this.serializeLogValue(value)}`)
			.join(" ");
	}

	private serializeLogValue(value: unknown): string {
		if (value === undefined || value === null) {
			return "<null>";
		}

		if (typeof value === "string") {
			return value;
		}

		if (typeof value === "number" || typeof value === "bigint") {
			return String(value);
		}

		if (typeof value === "boolean") {
			return value ? "true" : "false";
		}

		if (typeof value === "symbol") {
			return value.toString();
		}

		if (typeof value === "function") {
			return "<function>";
		}

		if (typeof value === "object") {
			try {
				return JSON.stringify(value);
			} catch {
				return "<unserializable>";
			}
		}

		return "<unhandled>";
	}

	private logInfo(message: string, data?: Record<string, unknown>): void {
		if (data && Object.keys(data).length > 0) {
			this.logger.info(`${message} ${this.formatLogData(data)}`);
			return;
		}

		this.logger.info(message);
	}

	private logError(
		message: string,
		error: unknown,
		data?: Record<string, unknown>,
	): void {
		const errorDescription =
			error instanceof Error ? error.message : this.serializeLogValue(error);

		const parts = [`${message}`, `error=${errorDescription}`];
		if (data && Object.keys(data).length > 0) {
			parts.push(this.formatLogData(data));
		}

		this.logger.error(parts.join(" "));
	}

	private ensureValidUrl(urlValue: string | undefined, field: string): void {
		if (!urlValue) {
			throw this.buildError(
				`Missing required ${field} for PhonePe configuration`,
				new Error(`${field} is not defined`),
			);
		}

		try {
			const parsedUrl = new URL(urlValue);
			const isLocalhost =
				parsedUrl.hostname === "localhost" ||
				parsedUrl.hostname === "127.0.0.1";

			if (parsedUrl.protocol !== "https:" && !isLocalhost) {
				throw new Error(
					"URL must use HTTPS scheme unless pointing to localhost",
				);
			}
		} catch (error) {
			throw this.buildError(
				`Invalid ${field} provided`,
				error instanceof Error ? error : new Error(String(error)),
			);
		}
	}
}

export default PhonePeBase;
