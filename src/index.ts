import { ModuleProvider, Modules } from "@medusajs/framework/utils";
import PhonePeProviderService from "./services/phonepe-provider.js";

const services = [PhonePeProviderService];

export default ModuleProvider(Modules.PAYMENT, {
  services,
});

export * from "./core/phonepe-base.js";
export * from "./services/phonepe-provider.js";
export * from "./types.js";
