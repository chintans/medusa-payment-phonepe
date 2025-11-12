import { PaymentIntentOptions, PhonePeOptions } from "../../types";
import PhonePeBase from "../phonepe-base";
export class PhonePeTest extends PhonePeBase {
	constructor(_, options: PhonePeOptions) {
		super(_, options);
	}

	get paymentIntentOptions(): PaymentIntentOptions {
		return {};
	}
}
