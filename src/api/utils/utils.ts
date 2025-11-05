import {
  AbstractCartCompletionStrategy,
  CartService,
  IdempotencyKeyService,
  Logger,
  OrderService,
  PaymentCollection,
  PaymentProviderError,
} from "@medusajs/framework/utils";
import { AwilixContainer } from "awilix";
import { MedusaError } from "@medusajs/framework/utils";
import { EOL } from "os";
import SHA256 from "crypto-js/sha256";
import {
  PhonePeEvent,
  PhonePeS2SResponse,
  PaymentStatusCodeValues,
} from "../../types";
import PhonePeProviderService from "../../services/phonepe-provider";

const PAYMENT_PROVIDER_KEY = "pp_phonepe";

export function constructWebhook({
  signature,
  encodedBody,
  container,
}: {
  signature: string;
  encodedBody: { response?: string } | string;
  container: AwilixContainer;
}): PhonePeEvent {
  const logger = container.resolve("logger") as Logger;
  const phonepeProviderService = container.resolve(
    PAYMENT_PROVIDER_KEY
  ) as PhonePeProviderService;

  // Handle both old format (encodedBody.response) and new format (direct JSON)
  const encodedData =
    typeof encodedBody === "string"
      ? encodedBody
      : encodedBody.response || JSON.stringify(encodedBody);

  logger.info(
    `signature ${signature}\n encoded: ${JSON.stringify(encodedBody)}`
  );
  return phonepeProviderService.constructWebhookEvent(encodedData, signature);
}

export function isPaymentCollection(id: string): boolean {
  return id && id.startsWith("paycol");
}

export function buildError(
  event: string,
  err: PaymentProviderError & Error
): string {
  let message = `PhonePe webhook ${event} handling failed${EOL}${
    err?.code ?? err?.message
  }`;
  // Check for PostgreSQL serialization failure (error code 23505)
  if (err?.code === "SERIALIZATION_FAILURE" || err?.code === "23505") {
    message = `PhonePe webhook ${event} handle failed. This can happen when this webhook is triggered during a cart completion and can be ignored. This event should be retried automatically.${EOL}${
      err?.detail ?? err?.message
    }`;
  }
  if (err?.code === "409") {
    message = `PhonePe webhook ${event} handle failed.${EOL}${
      err?.detail ?? err?.message
    }`;
  }

  return message;
}

export async function handlePaymentHook({
  event,
  container,
  paymentIntent,
}: {
  event: PhonePeEvent;
  container: AwilixContainer;
  paymentIntent: PhonePeS2SResponse;
}): Promise<{ statusCode: number }> {
  const logger = container.resolve("logger") as Logger;

  // Handle both old format (merchantTransactionId) and new format (merchantOrderId)
  let merchantOrderId =
    paymentIntent.data?.merchantOrderId ||
    paymentIntent.data?.merchantTransactionId;

  if (!merchantOrderId) {
    logger.error("No merchantOrderId or merchantTransactionId found in webhook");
    return { statusCode: 400 };
  }

  // Extract cart ID from merchantOrderId (format: cartId_sequence)
  const cartIdParts = merchantOrderId.split("_");
  const cartId = `${cartIdParts[0]}_${cartIdParts[1]}`;
  logger.info("computed cart: " + cartId);
  const resourceId = cartId;

  // Handle new webhook event types
  const eventType = event.event || event.type || paymentIntent.code;

  switch (eventType) {
    case "checkout.order.completed":
    case PaymentStatusCodeValues.PAYMENT_SUCCESS:
    case PaymentStatusCodeValues.SUCCESS:
      try {
        await onPaymentIntentSucceeded({
          eventId: event.id,
          paymentIntent,
          cartId,
          resourceId,
          isPaymentCollection: isPaymentCollection(resourceId),
          container,
        });
      } catch (err: any) {
        const message = buildError(eventType, err);
        logger.error(message);
        return { statusCode: 409 };
      }
      break;

    case "checkout.order.failed":
    case PaymentStatusCodeValues.PAYMENT_ERROR:
    case PaymentStatusCodeValues.PAYMENT_DECLINED: {
      const message = paymentIntent.message;
      logger.error(
        "The payment of the payment intent " +
          `${merchantOrderId} has failed${EOL}${message}`
      );
      break;
    }

    case "pg.refund.completed":
    case "pg.refund.failed":
      logger.info(
        `Refund webhook received: ${eventType} for ${merchantOrderId}`
      );
      // Handle refund webhooks if needed
      break;

    default:
      logger.info(`Unhandled webhook event type: ${eventType}`);
      return { statusCode: 204 };
  }

  return { statusCode: 200 };
}

async function onPaymentIntentSucceeded({
  eventId,
  paymentIntent,
  cartId,
  resourceId,
  isPaymentCollection,
  container,
}: {
  eventId: string;
  paymentIntent: PhonePeS2SResponse;
  cartId: string;
  resourceId: string;
  isPaymentCollection: boolean;
  container: AwilixContainer;
}) {
  const manager = container.resolve("manager");

  await manager.transaction(async (transactionManager) => {
    if (isPaymentCollection) {
      await capturePaymentCollectionIfNecessary({
        paymentIntent,
        resourceId,
        container,
      });
    } else {
      await completeCartIfNecessary({
        eventId,
        cartId,
        container,
        transactionManager,
      });

      await capturePaymentIfNecessary({
        cartId,
        transactionManager,
        container,
      });
    }
  });
}

async function capturePaymentCollectionIfNecessary({
  paymentIntent,
  resourceId,
  container,
}: {
  paymentIntent: PhonePeS2SResponse;
  resourceId: string;
  container: AwilixContainer;
}) {
  const manager = container.resolve("manager");
  const paymentCollectionService = container.resolve(
    "paymentCollectionService"
  );
  const logger = container.resolve("logger") as Logger;
  logger.info("attempting to collect payment");
  const paycol = (await paymentCollectionService
    .retrieve(resourceId, { relations: ["payments"] })
    .catch(() => undefined)) as PaymentCollection;

  if (paycol?.payments?.length) {
    const merchantOrderId =
      paymentIntent.data?.merchantOrderId ||
      paymentIntent.data?.merchantTransactionId;
    logger.info(`attempting to collect payment of ${merchantOrderId}`);

    const payment = paycol.payments.find(
      (pay: any) =>
        pay.data?.merchantOrderId === merchantOrderId ||
        pay.data?.merchantTransactionId === merchantOrderId
    );
    if (payment && !payment.captured_at) {
      await manager.transaction(async (manager) => {
        await paymentCollectionService
          .withTransaction(manager)
          .capture(payment.id);
      });
    }
  }
}

async function capturePaymentIfNecessary({
  cartId,
  transactionManager,
  container,
}: {
  cartId: string;
  transactionManager: any;
  container: AwilixContainer;
}) {
  const logger = container.resolve("logger") as Logger;
  logger.info("attempting to capture payment");
  const orderService = container.resolve("orderService") as OrderService;
  const order = await orderService
    .withTransaction(transactionManager)
    .retrieveByCartId(cartId)
    .catch(() => {
      logger.info(`No Order with cart Id ${cartId}`);
      return undefined;
    });

  if (order && order.payment_status !== "captured") {
    logger.info(`attempting to capture payment order ${order.id}`);
    await orderService
      .withTransaction(transactionManager)
      .capturePayment(order.id);
  }
}

async function completeCartIfNecessary({
  eventId,
  cartId,
  container,
  transactionManager,
}: {
  eventId: string;
  cartId: string;
  container: AwilixContainer;
  transactionManager: any;
}) {
  const orderService = container.resolve("orderService");
  const logger = container.resolve("logger") as Logger;
  logger.info(`completing cart ${cartId}`);
  const order = await orderService
    .retrieveByCartId(cartId)
    .catch(() => undefined);

  if (!order) {
    logger.info(`initiating cart completing strategy ${cartId}`);
    const completionStrat: AbstractCartCompletionStrategy = container.resolve(
      "cartCompletionStrategy"
    );
    const cartService: CartService = container.resolve("cartService");
    const idempotencyKeyService: IdempotencyKeyService = container.resolve(
      "idempotencyKeyService"
    );

    const idempotencyKeyServiceTx =
      idempotencyKeyService.withTransaction(transactionManager);
    let idempotencyKey = await idempotencyKeyServiceTx
      .retrieve({
        request_path: "/phonepe/hooks",
        idempotency_key: eventId,
      })
      .catch(() => undefined);

    if (!idempotencyKey) {
      idempotencyKey = await idempotencyKeyService
        .withTransaction(transactionManager)
        .create({
          request_path: "/phonepe/hooks",
          idempotency_key: eventId,
        });
    }
    logger.info(`obtained idempotence key ${cartId}`);
    const cart = await cartService
      .withTransaction(transactionManager)
      .retrieve(cartId, { select: ["context"] });
    const { response_code, response_body } = await completionStrat
      .withTransaction(transactionManager)
      .complete(cartId, idempotencyKey, { ip: cart.context?.ip as string });

    if (response_code !== 200) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        response_body["message"] as string,
        response_body["code"] as string
      );
    }
  } else {
    logger.info(`cart completed ${cartId}`);
  }
}

// Legacy checksum functions (kept for backward compatibility with webhook validation)
export function createPostCheckSumHeader(
  payload: any,
  salt?: string,
  apiString?: string,
  space = 2
) {
  const SALT_KEY = salt ?? process.env.PHONEPE_SALT ?? "test-salt";
  const encodedBody = Buffer.from(JSON.stringify(payload, null, space)).toString("base64");
  const base64string = encodedBody + `${apiString ?? ""}${SALT_KEY}`;
  const encodedPayload = SHA256(base64string).toString();
  const checksum = `${encodedPayload}###1`;
  return { checksum, encodedBody };
}

export function verifyPostCheckSumHeader(
  payload: string,
  salt?: string,
  apiString?: string
) {
  const SALT_KEY = salt ?? process.env.PHONEPE_SALT ?? "test-salt";
  const base64string = payload + `${apiString ?? ""}${SALT_KEY}`;
  const encodedPayload = SHA256(base64string).toString();
  const checksum = `${encodedPayload}###1`;
  return { checksum, payload };
}

// Legacy functions (deprecated - kept for backward compatibility)
export function createPostPaymentChecksumHeader(
  payload: any,
  salt?: string
) {
  return createPostCheckSumHeader(payload, salt, "/pg/v1/pay");
}

export function createPostRefundChecksumHeader(
  payload: any,
  salt?: string
) {
  return createPostCheckSumHeader(payload, salt, "/pg/v1/refund");
}

export function createPostValidateVpaChecksumHeader(
  payload: {
    merchantId: string;
    vpa: string;
  },
  salt?: string
) {
  return createPostCheckSumHeader(payload, salt, "/pg/v1/vpa/validate");
}

export function createGetChecksumHeader(
  merchantId: string,
  merchantTransactionId: string,
  salt?: string
) {
  const SALT_KEY = salt ?? process.env.PHONEPE_SALT ?? "test-salt";
  const asciiString = `/pg/v1/status/${merchantId}/${merchantTransactionId}${SALT_KEY}`;
  const encodedPayload = SHA256(asciiString).toString();
  const checksum = `${encodedPayload}###1`;
  return { checksum };
}

export function createGetChecksumTransactionHeader(
  merchantId: string,
  merchantTransactionId: string,
  salt?: string
) {
  const SALT_KEY = salt ?? process.env.PHONEPE_SALT ?? "test-salt";
  const asciiString = `/pg/v3/transaction/${merchantId}/${merchantTransactionId}/status${SALT_KEY}`;
  const encodedPayload = SHA256(asciiString).toString();
  const checksum = `${encodedPayload}###1`;
  return { checksum };
}

// Export buildError for backward compatibility
export { buildError };
