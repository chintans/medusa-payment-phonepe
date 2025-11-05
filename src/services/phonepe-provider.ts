import PhonePeBase from "../core/phonepe-base";
import { PaymentIntentOptions, PaymentProviderKeys, PhonePeOptions } from "../types";
import { Logger } from "@medusajs/framework/utils";

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
