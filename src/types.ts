export interface PhonePeOptions {
  enabledDebugLogging?: boolean;
  redirectUrl: string;
  callbackUrl: string;
  merchantId: string;
  salt: string;
  mode: "production" | "test" | "uat";
  // OAuth configuration for PhonePe v2 API
  clientId: string;
  clientSecret: string;
  clientVersion: number;
  tokenCacheEnabled?: boolean;
  shouldPublishEvents?: boolean;
  // Webhook validation credentials (required for SDK webhook validation)
  merchantUsername?: string;
  merchantPassword?: string;
  // Legacy options (kept for backward compatibility during migration)
  redirectMode?: "REDIRECT" | "POST";
  capture?: boolean;
  automatic_payment_methods?: boolean;
  payment_description?: string;
}

export interface PaymentIntentOptions {
  capture_method?: "automatic" | "manual";
  setup_future_usage?: "on_session" | "off_session";
  payment_method_types?: string[];
}

export const ErrorCodes = {
  PAYMENT_INTENT_UNEXPECTED_STATE: "payment_intent_unexpected_state",
  UNSUPPORTED_OPERATION: "unsupported_operation",
};

export const ErrorIntentStatus = {
  SUCCEEDED: "succeeded",
  CANCELED: "canceled",
};

export const PaymentProviderKeys = {
  PHONEPE: "phonepe",
};

// OAuth Token Types
export interface OAuthTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  expires_on: number;
}

export interface OAuthTokenCache {
  token: string;
  expiresAt: number;
}

// PhonePe v2 API Request Types
export interface PaymentRequestV2 {
  merchantOrderId: string;
  amount: number;
  expireAfter?: number; // in seconds (min: 300, max: 3600)
  metaInfo?: {
    udf1?: string;
    udf2?: string;
    udf3?: string;
    udf4?: string;
    udf5?: string;
  };
  paymentFlow: {
    type: "PG_CHECKOUT";
    message?: string;
    merchantUrls: {
      redirectUrl: string;
    };
    paymentModeConfig?: {
      enabledPaymentModes?: PaymentMode[];
      disabledPaymentModes?: PaymentMode[];
    };
  };
}

export interface PaymentMode {
  type: "UPI_INTENT" | "UPI_COLLECT" | "UPI_QR" | "NET_BANKING" | "CARD";
  cardTypes?: ("DEBIT_CARD" | "CREDIT_CARD")[];
}

// PhonePe v2 API Response Types
export interface PaymentResponseV2 {
  code: string;
  message: string;
  data?: PaymentResponseDataV2;
  merchantTransactionId?: string;
}

export interface PaymentResponseDataV2 {
  merchantTransactionId: string;
  instrumentResponse: InstrumentResponseV2;
}

export interface InstrumentResponseV2 {
  type: string;
  redirectInfo?: RedirectInfoV2;
  qrData?: string;
  intentUrl?: string;
}

export interface RedirectInfoV2 {
  url: string;
  mode: string;
}

// Order Status Response Types
export interface OrderStatusResponseV2 {
  code: string;
  message: string;
  data?: OrderStatusDataV2;
}

export interface OrderStatusDataV2 {
  merchantOrderId: string;
  transactionId?: string;
  amount: number;
  state: string;
  responseCode: string;
  paymentInstrument?: PaymentInstrumentV2;
}

export interface PaymentInstrumentV2 {
  type: string;
  utr?: string;
  cardType?: string;
  pgTransactionId?: string;
  bankTransactionId?: string;
  pgAuthorizationCode?: string;
  arn?: string;
  bankId?: string;
  pgServiceTransactionId?: string;
}

// Refund Request/Response Types
export interface RefundRequestV2 {
  merchantId: string;
  merchantRefundId: string;
  originalTransactionId: string;
  amount: number;
  callbackUrl: string;
}

export interface RefundResponseV2 {
  code: string;
  message: string;
  data?: RefundResponseDataV2;
}

export interface RefundResponseDataV2 {
  merchantRefundId: string;
  transactionId: string;
  amount: number;
  state: string;
  responseCode: string;
}

// Legacy types (for backward compatibility during migration)
export type PaymentRequest =
  | PaymentRequestUPI
  | PaymentRequestUPICollect
  | PaymentRequestUPIQr
  | PaymentRequestWebFlow;

export type PaymentResponse =
  | PaymentResponseUPI
  | PaymentResponseUPICollect
  | PaymentResponseUPIQr
  | PaymentResponseWebFlow;

export interface PaymentRequestUPI {
  merchantId: string;
  merchantTransactionId: string;
  merchantUserId: string;
  redirectUrl: string;
  redirectMode: string;
  amount: number;
  callbackUrl: string;
  mobileNumber?: string;
  deviceContext?: DeviceContext;
  paymentInstrument: PaymentInstrumentUPI;
}

export interface PaymentResponseUPI {
  success: boolean;
  code: PaymentStatusCodeValues;
  message: string;
  data: PaymentResponseData;
}

export interface PaymentResponseData {
  merchantId: string;
  merchantTransactionId: string;
  instrumentResponse?: InstrumentResponse;
  customer: { id: string };
}

export interface DeviceContext {
  deviceOS: string;
}

export interface AccountConstraint {
  accountNumber: string;
  ifsc: string;
}

export interface PaymentRequestUPICollect {
  merchantId: string;
  merchantTransactionId: string;
  merchantUserId: string;
  redirectUrl: string;
  redirectMode: string;
  amount: number;
  callbackUrl: string;
  mobileNumber: string;
  paymentInstrument: PaymentInstrument;
}

export interface PaymentResponseUPICollect {
  success: boolean;
  code: PaymentStatusCodeValues;
  message: string;
  data: PaymentResponseUPICollectData;
}

export interface PaymentResponseUPICollectData {
  merchantId: string;
  merchantTransactionId: string;
  instrumentResponse: InstrumentResponse;
}

export interface PaymentRequestUPIQr {
  merchantId: string;
  merchantTransactionId: string;
  merchantUserId: string;
  redirectUrl: string;
  redirectMode: string;
  amount: number;
  callbackUrl: string;
  mobileNumber: string;
  paymentInstrument: PaymentInstrument;
}

export interface PaymentResponseUPIQr {
  success: boolean;
  code: PaymentStatusCodeValues;
  message: string;
  data: PaymentResponseUPIQrData;
}

export interface PaymentResponseUPIQrData {
  merchantId: string;
  merchantTransactionId: string;
  instrumentResponse: InstrumentResponse;
}

export interface InstrumentResponse {
  type: string;
  qrData?: string;
  intentUrl?: string;
  redirectInfo?: RedirectInfo;
}

export interface PaymentRequestWebFlow {
  merchantId: string;
  merchantTransactionId: string;
  merchantUserId: string;
  amount: number;
  redirectUrl: string;
  redirectMode: string;
  callbackUrl: string;
  mobileNumber: string;
  paymentInstrument: PaymentInstrument;
}

export interface PaymentResponseWebFlow {
  success: boolean;
  code: PaymentStatusCodeValues;
  message: string;
  data: PaymentResponseWebFlowData;
}

export interface PaymentResponseWebFlowData {
  merchantId: string;
  merchantTransactionId: string;
  instrumentResponse: InstrumentResponse;
}

export interface RedirectInfo {
  url: string;
  method: string;
}

export interface RefundRequest {
  merchantId: string;
  merchantUserId: string;
  originalTransactionId: string;
  merchantTransactionId: string;
  amount: number;
  callbackUrl: string;
}

export interface RefundResponse {
  success: boolean;
  code: PaymentStatusCodeValues;
  message: string;
  data: RefundResponseData;
}

export interface RefundResponseData {
  merchantId: string;
  merchantTransactionId: string;
  transactionId: string;
  amount: number;
  state: string;
  responseCode: string;
}

export type PaymentCheckStatusResponse =
  | PaymentCheckStatusResponseUPI
  | PaymentCheckStatusResponseCard
  | PaymentCheckStatusResponseNetBanking;

export interface PaymentCheckStatusResponseUPI {
  success: boolean;
  code: PaymentStatusCodeValues;
  message: string;
  data?: PaymentCheckStatusResponseUPIData;
}

export interface PaymentCheckStatusResponseUPIData {
  merchantId: string;
  merchantTransactionId: string;
  transactionId: string;
  amount: number;
  state: string;
  responseCode: string;
  paymentInstrument: PaymentInstrument;
}

export interface PaymentCheckStatusResponseCard {
  success: boolean;
  code: PaymentStatusCodeValues;
  message: string;
  data: PaymentCheckStatusResponseCardData;
}

export interface PaymentCheckStatusResponseCardData {
  merchantId: string;
  merchantTransactionId: string;
  transactionId: string;
  amount: number;
  state: string;
  responseCode: string;
  paymentInstrument: PaymentInstrument;
}

export type PaymentInstrument = PaymentInstrumentNetBanking &
  PaymentInstrumentCard &
  PaymentInstrumentUPI &
  PaymentInstrumentWeb;

export enum PaymentStatusCodeValues {
  "BAD_REQUEST" = "BAD_REQUEST",
  "AUTHORIZATION_FAILED" = "AUTHORIZATION_FAILED",
  "INTERNAL_SERVER_ERROR" = "INTERNAL_SERVER_ERROR",
  "TRANSACTION_NOT_FOUND" = "TRANSACTION_NOT_FOUND",
  "PAYMENT_ERROR" = "PAYMENT_ERROR",
  "PAYMENT_PENDING" = "PAYMENT_PENDING",
  "PAYMENT_DECLINED" = "PAYMENT_DECLINED",
  "TIMED_OUT" = "TIMED_OUT",
  "PAYMENT_SUCCESS" = "PAYMENT_SUCCESS",
  "PAYMENT_CANCELLED" = "PAYMENT_CANCELLED",
  "PAYMENT_INITIATED" = "PAYMENT_INITIATED",
  "SUCCESS" = "SUCCESS",
}

export interface PaymentCheckStatusResponseNetBanking {
  success: boolean;
  code: PaymentStatusCodeValues;
  message: string;
  data: PaymentCheckStatusResponseNetBankingData;
}

export interface PaymentCheckStatusResponseNetBankingData {
  merchantId: string;
  merchantTransactionId: string;
  transactionId: string;
  amount: number;
  state: string;
  responseCode: string;
  paymentInstrument: PaymentInstrumentNetBanking;
}

export interface PaymentInstrumentNetBanking {
  type: string;
  pgTransactionId: string;
  pgServiceTransactionId: string;
  bankTransactionId: any;
  bankId: string;
}

export interface PaymentInstrumentCard {
  type: string;
  cardType: string;
  pgTransactionId: string;
  bankTransactionId: string;
  pgAuthorizationCode: string;
  arn: string;
  bankId: string;
  brn: string;
}

export interface PaymentInstrumentWeb {
  type: string;
}

export interface PaymentInstrumentUPI {
  type: string;
  utr?: string;
  targetApp?: string;
  accountConstraints?: AccountConstraint[];
}

// Webhook Event Types
export interface PhonePeEvent {
  event: string; // checkout.order.completed, checkout.order.failed, pg.refund.completed, pg.refund.failed
  id: string;
  data: {
    object: PhonePeS2SResponse;
  };
}

export interface PhonePeS2SResponse {
  success: boolean;
  code: PaymentStatusCodeValues;
  message: string;
  data: PhonePeS2SResponseData;
}

export interface PhonePeS2SResponseData {
  merchantId: string;
  merchantTransactionId: string;
  merchantOrderId?: string;
  transactionId: string;
  amount: number;
  state: string;
  responseCode: string;
  paymentInstrument: PhonePeS2SResponsePaymentInstrument;
}

export type PhonePeS2SResponsePaymentInstrument =
  PhonePeS2SResponsePaymentInstrumentUpi &
    PhonePeS2SResponsePaymentInstrumentCard &
    PhonePeS2SResponsePaymentInstrumentNetBanking;

export interface PhonePeS2SResponsePaymentInstrumentUpi {
  type: string;
  utr?: string;
}

export interface PhonePeS2SResponsePaymentInstrumentCard {
  type: string;
  cardType?: string;
  pgTransactionId?: string;
  bankTransactionId?: string;
  pgAuthorizationCode?: string;
  arn?: string;
  bankId?: string;
  utr?: string;
}

export interface PhonePeS2SResponsePaymentInstrumentNetBanking {
  type: string;
  pgTransactionId?: string;
  pgServiceTransactionId?: string;
  bankTransactionId?: string;
  bankId?: string;
  utr?: string;
}
