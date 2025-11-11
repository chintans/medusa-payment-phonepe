import PhonePeBase from "../core/phonepe-base.js";
import {
  PaymentIntentOptions,
  PaymentProviderKeys,
  PhonePeOptions,
} from "../types.js";
import { Logger } from "@medusajs/framework/types";

class PhonePeProviderService extends PhonePeBase {
  static identifier = PaymentProviderKeys.PHONEPE;

  constructor(container: { logger: Logger }, options: PhonePeOptions) {
    super(container, options);
  }

  get paymentIntentOptions(): PaymentIntentOptions {
    return {};
  }
}

export default PhonePeProviderService;
