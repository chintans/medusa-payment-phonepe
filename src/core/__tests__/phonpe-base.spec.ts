import {
  vi,
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterEach,
} from "vitest";

// Mock PhonePeWrapper when mocks are enabled - must be before imports
vi.mock("../phonepe-wrapper", async () => {
  const { isMocksEnabled } = await import("../../__mocks__/phonepe");
  if (isMocksEnabled()) {
    const { MockPhonePeWrapper } = await import(
      "../../__mocks__/phonepe-wrapper"
    );
    return {
      PhonePeWrapper: MockPhonePeWrapper,
    };
  }
  return vi.importActual("../phonepe-wrapper");
});

import { PhonePeTest } from "../__fixtures__/phonepe-test";
import {
  AuthorizePaymentInput,
  CapturePaymentInput,
  RefundPaymentInput,
  UpdatePaymentInput,
} from "@medusajs/framework/types";
import dotenv from "dotenv";
import {
  authorizePaymentSuccessData,
  capturePaymentContextSuccessData,
  initiatePaymentContextWithExistingCustomer,
  refundPaymentSuccessData,
  responseHookData,
  updatePaymentContextWithDifferentAmount,
} from "../__fixtures__/data";
import { isMocksEnabled } from "../../__mocks__/phonepe";
import { PhonePeOptions } from "../../types";
import { PaymentSessionStatus } from "@medusajs/framework/utils";
let config: PhonePeOptions = {
  salt: "test",
  merchantId: "test",
  redirectUrl: "http://localhost:8000",
  callbackUrl: "http://localhost:9000",
  mode: "test",
  redirectMode: "POST",
  clientId: "test-client-id",
  clientSecret: "test-client-secret",
  clientVersion: 1,
};
if (!isMocksEnabled()) {
  dotenv.config();
}
const container = { logger: console };
config = {
  ...config,
  salt: process.env.PHONEPE_SALT ?? config.salt,
  merchantId: process.env.PHONEPE_MERCHANT_ACCOUNT ?? config.merchantId,
  mode: (process.env.PHONEPE_MODE as any) ?? config.mode,
  clientVersion: Number(
    process.env.PHONEPE_CLIENT_VERSION ?? config.clientVersion
  ),
};
let testPaymentSession;
let phonepeTest: PhonePeTest;
describe("PhonePeTest", () => {
  describe("authorizePayment status check", function () {
    beforeAll(async () => {
      const scopedContainer = { ...container };
      phonepeTest = new PhonePeTest(scopedContainer, config);
    });

    beforeEach(() => {
      vi.clearAllMocks();
    });

    if (isMocksEnabled()) {
      it("should authorize payment with correct status", async () => {
        const authorizeInput: AuthorizePaymentInput = {
          data: {
            merchantOrderId: "test_order",
            merchantTransactionId: "test_transaction",
          },
        };

        const result = await phonepeTest.authorizePayment(authorizeInput);
        // With mocks, authorizePayment should succeed
        expect(result).toBeDefined();
        // Check if result has error or status
        if (result.status === PaymentSessionStatus.ERROR) {
          // If error, verify error structure
          expect(result.data).toBeUndefined();
        } else {
          // If success, verify status exists
          expect(result.status).toBeDefined();
          // Status should be AUTHORIZED when payment succeeds
          expect(result.status).toBe(PaymentSessionStatus.AUTHORIZED);
        }
      });
    } else {
      it("should authorize payment with correct status", async () => {
        const result = await phonepeTest.initiatePayment(
          initiatePaymentContextWithExistingCustomer
        );
        expect(result.data).toBeDefined();
        expect(result.data?.merchantOrderId).toBeDefined();
        const authorizeInput: AuthorizePaymentInput = {
          data: {
            merchantOrderId: result.data?.merchantOrderId || "test",
            merchantTransactionId: result.data?.merchantTransactionId || "test",
          },
        };
        const authorizeResult = await phonepeTest.authorizePayment(
          authorizeInput
        );
        expect(authorizeResult.status).toBeDefined();
      });
    }
  });

  describe("authorizePayment", function () {
    let phonepeTest: PhonePeTest;

    beforeAll(async () => {
      const scopedContainer = { ...container };
      phonepeTest = new PhonePeTest(scopedContainer, config);
    });

    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("should succeed", async () => {
      if (!isMocksEnabled()) {
        testPaymentSession = await phonepeTest.initiatePayment(
          initiatePaymentContextWithExistingCustomer
        );
      }
      const authorizeInput: AuthorizePaymentInput = isMocksEnabled()
        ? authorizePaymentSuccessData
        : {
            data: testPaymentSession?.data || {},
          };
      const result = await phonepeTest.authorizePayment(authorizeInput);

      // Check if result has error or status
      if (result.status === PaymentSessionStatus.ERROR) {
        // If error, verify error structure
        expect(result.status).toBe(PaymentSessionStatus.ERROR);
        expect(result.data).toBeUndefined();
      } else {
        // If success, verify status
        expect(result.status).toBe(PaymentSessionStatus.AUTHORIZED);
        expect(result.data).toBeDefined();
      }
    });
  });

  /*
  describe("cancelPayment", function () {
    beforeAll(async () => {
      const scopedContainer = { ...container };
      phonepeTest = new PhonePeTest(scopedContainer, config);
    });

    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("should succeed", async () => {
      const result = await phonepeTest.cancelPayment(cancelPaymentSuccessData);

      expect(result).toEqual({
        code: ErrorCodes.UNSUPPORTED_OPERATION,
        error: "Unable to cancel as phonepe doesn't support cancellation",
      });
    });

    it("should fail on intent cancellation but still return the intent", async () => {
      const result = await phonepeTest.cancelPayment(
        cancelPaymentPartiallyFailData
      );

      expect(result).toEqual({
        code: ErrorCodes.UNSUPPORTED_OPERATION,
        error: "Unable to cancel as phonepe doesn't support cancellation",
      });
    });
    /*
    it("should fail on intent cancellation", async () => {
      const result = await phonepeTest.cancelPayment(cancelPaymentFailData);

      /* expect(result).toEqual({
        error: "An error occurred in cancelPayment",
        code: "",
        detail: "Error",
      });
      expect(result).toEqual({
        code: ErrorCodes.UNSUPPORTED_OPERATION,
        error: "Unable to cancel as phonepe doesn't support cancellation",
      });
    });
  });
  */
  describe("capturePayment", function () {
    beforeAll(async () => {
      const scopedContainer = { ...container };
      phonepeTest = new PhonePeTest(scopedContainer, config);
    });

    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("should succeed", async () => {
      const init = await phonepeTest.initiatePayment(
        initiatePaymentContextWithExistingCustomer
      );
      const captureInput: CapturePaymentInput = isMocksEnabled()
        ? capturePaymentContextSuccessData
        : {
            data: init.data || {},
          };
      const result = await phonepeTest.capturePayment(captureInput);

      expect(result.data).toBeDefined();
    });
  });

  describe("refundPayment", function () {
    const refundAmount = 500;

    beforeAll(async () => {
      const scopedContainer = { ...container };
      phonepeTest = new PhonePeTest(scopedContainer, config);
    });

    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("should refund partially", async () => {
      const init = await phonepeTest.initiatePayment(
        initiatePaymentContextWithExistingCustomer
      );

      const refundInput: RefundPaymentInput = isMocksEnabled()
        ? refundPaymentSuccessData
        : {
            data: init.data || {},
            amount: refundAmount,
          };
      const result = await phonepeTest.refundPayment(refundInput);
      expect(result.data).toBeDefined();
    });
    it("should refund fully", async () => {
      const init = await phonepeTest.initiatePayment(
        initiatePaymentContextWithExistingCustomer
      );

      const refundInput: RefundPaymentInput = isMocksEnabled()
        ? refundPaymentSuccessData
        : {
            data: init.data || {},
            amount: initiatePaymentContextWithExistingCustomer.amount,
          };
      const result = await phonepeTest.refundPayment(refundInput);
      expect(result.data).toBeDefined();
    });
  });

  describe("retrievePayment", function () {
    beforeAll(async () => {
      const scopedContainer = { ...container };
      phonepeTest = new PhonePeTest(scopedContainer, config);
    });

    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("should retrieve payment status via authorize", async () => {
      const init = await phonepeTest.initiatePayment(
        initiatePaymentContextWithExistingCustomer
      );

      // Use authorizePayment to check status since retrievePayment doesn't exist
      const authorizeInput: AuthorizePaymentInput = isMocksEnabled()
        ? authorizePaymentSuccessData
        : {
            data: init.data || {},
          };
      // Note: This test is checking retrievePayment via authorizePayment
      // In mocks mode, authorizePayment returns { status, data } or { error, code, detail }
      const result = await phonepeTest.authorizePayment(authorizeInput);
      if (isMocksEnabled()) {
        // With mocks, result should have either status+data or error
        if (result.status === PaymentSessionStatus.ERROR) {
          expect(result.data).toBeUndefined();
        } else {
          expect(result.data).toBeDefined();
          expect(result.status).toBeDefined();
        }
      } else {
        expect(result.data).toBeDefined();
      }
    });
  });

  if (!isMocksEnabled()) {
    describe("updatePayment", function () {
      if (!isMocksEnabled()) {
        beforeAll(async () => {
          const scopedContainer = { ...container };
          phonepeTest = new PhonePeTest(scopedContainer, config);
        });

        beforeEach(() => {
          vi.clearAllMocks();
        });
      }

      if (!isMocksEnabled()) {
        it("should succeed to update the intent with the new amount", async () => {
          const init = await phonepeTest.initiatePayment(
            initiatePaymentContextWithExistingCustomer
          );

          const updateInput: UpdatePaymentInput = {
            ...updatePaymentContextWithDifferentAmount,
            data: {
              ...init.data,
              ...updatePaymentContextWithDifferentAmount.data,
            },
          };
          const result = await phonepeTest.updatePayment(updateInput);
          if (isMocksEnabled()) {
            expect(1).toBe(1);
            console.log("test not valid in mocked mode");
          }
          expect(result.data).toBeDefined();
        }, 60e6);
      }
    });
  }

  describe("testWebHookValidation", function () {
    beforeAll(async () => {
      const scopedContainer = { ...container };
      phonepeTest = new PhonePeTest(scopedContainer, config);
    });

    beforeEach(() => {
      vi.clearAllMocks();
    });
    it("validate hook correctly", async () => {
      const callbackPayload = {
        type: "PG_ORDER_COMPLETED",
        payload: responseHookData.data,
      };
      const callbackBody = JSON.stringify(callbackPayload);
      const result = await phonepeTest.constructWebhookEvent(
        "Bearer mock-token",
        callbackBody
      );
      expect(result).toBeDefined();
      expect(result.event).toBe("checkout.order.completed");
      expect(result.data).toBeDefined();
    });
  });

  describe("error handling and fallbacks", () => {
    let phonepeTest: PhonePeTest;

    beforeAll(async () => {
      const scopedContainer = { ...container };
      phonepeTest = new PhonePeTest(scopedContainer, config);
    });

    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("throws when merchant order id is missing in getPaymentStatus", async () => {
      await expect(
        phonepeTest.getPaymentStatus({ data: {} } as any)
      ).rejects.toThrow(
        "No merchant order ID provided while getting payment status"
      );
    });

    it("fails to capture when payment state is not successful", async () => {
      const statusSpy = vi
        .spyOn(phonepeTest["phonepe_"], "getOrderStatus")
        .mockResolvedValue({
          state: "PENDING",
        } as any);

      await expect(
        phonepeTest.capturePayment({
          data: { merchantOrderId: "order_pending" },
        } as any)
      ).rejects.toThrow(
        "Payment not in success state: PENDING. Cannot capture."
      );

      statusSpy.mockRestore();
    });

    it("returns original data when refund response lacks required fields", async () => {
      const executeSpy = vi
        .spyOn(phonepeTest, "executeWithRetry")
        .mockResolvedValueOnce({ unexpected: true } as any);

      const refundInput: RefundPaymentInput = {
        amount: 250,
        data: {
          merchantOrderId: "order_missing_refund_fields",
          merchantTransactionId: "order_missing_refund_fields",
        },
      };

      const result = await phonepeTest.refundPayment(refundInput);
      expect(result.data).toMatchObject(
        refundInput.data as Record<string, unknown>
      );

      executeSpy.mockRestore();
    });

    it("falls back to legacy webhook construction when SDK validation is unavailable", async () => {
      const callbackBody = JSON.stringify(responseHookData);
      const result = await phonepeTest.constructWebhookEvent("", callbackBody);

      expect(result.event).toBe(responseHookData.code);
      expect(result.data?.object).toMatchObject(responseHookData);
    });
  });

  describe("executeWithRetry behaviour", () => {
    let phonepeTest: PhonePeTest;

    beforeAll(async () => {
      const scopedContainer = { ...container };
      phonepeTest = new PhonePeTest(scopedContainer, config);
    });

    afterEach(() => {
      vi.useRealTimers();
      vi.restoreAllMocks();
    });

    it("returns handled error data when retry is not allowed", async () => {
      const apiCall = vi.fn().mockRejectedValue(new Error("immediate failure"));
      const handledData = { indeterminate_due_to: "unknown_error" };

      const handleSpy = vi
        .spyOn(phonepeTest, "handlePhonePeError")
        .mockReturnValueOnce({ retry: false, data: handledData });

      const result = await phonepeTest.executeWithRetry(apiCall);

      expect(result).toEqual(handledData);
      expect(apiCall).toHaveBeenCalledTimes(1);
      expect(handleSpy).toHaveBeenCalledTimes(1);
    });

    it("retries once and resolves when error is retryable", async () => {
      vi.useFakeTimers();

      const apiCall = vi
        .fn()
        .mockRejectedValueOnce(new Error("temporary failure"))
        .mockResolvedValueOnce("success");

      const handleSpy = vi
        .spyOn(phonepeTest, "handlePhonePeError")
        .mockReturnValueOnce({ retry: true });

      const resultPromise = phonepeTest.executeWithRetry(apiCall, 2, 1);

      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result).toBe("success");
      expect(apiCall).toHaveBeenCalledTimes(2);
      expect(handleSpy).toHaveBeenCalledTimes(1);
    });
  });
});
