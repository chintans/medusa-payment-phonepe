# MEDUSA-PAYMENT-PHONEPE

PhonePe Payment provider for MedusaJS v2.x

[PHONEPE](https://phonepe.com) is an immensely popular payment gateway with a host of features.
This plugin enables the PhonePe payment interface on [MedusaJS v2.x](https://medusajs.com) commerce stack.

## Version

**v2.0.0** - This version is compatible with:

- MedusaJS v2.x
- PhonePe Payment Gateway API v2 (with OAuth authentication)

## Installation

Install the plugin using your package manager:

```bash
yarn add medusa-payment-phonepe
# or
npm install medusa-payment-phonepe
# or
pnpm add medusa-payment-phonepe
```

## Prerequisites

- MedusaJS v2.x installed and running
- PhonePe merchant account with:
  - Merchant ID
  - Salt key (for webhook verification)
  - OAuth Client ID
  - OAuth Client Secret

## Configuration

### Environment Variables

Add the following to your `.env` file:

```env
PHONEPE_SALT=<your-supplied-salt>
PHONEPE_MODE=production|uat|test
PHONEPE_MERCHANT_ID=<your-merchant-id>
PHONEPE_CLIENT_ID=<your-oauth-client-id>
PHONEPE_CLIENT_SECRET=<your-oauth-client-secret>
PHONEPE_REDIRECT_URL=<your-redirect-url>
PHONEPE_CALLBACK_URL=<your-callback-url>
PHONEPE_MERCHANT_USERNAME=<your-merchant-username>  # Required for webhook validation
PHONEPE_MERCHANT_PASSWORD=<your-merchant-password>  # Required for webhook validation
```

### MedusaJS Configuration

Add the plugin to your `medusa-config.ts` (or `medusa-config.js`):

```typescript
import { defineConfig } from "@medusajs/framework/utils";

export default defineConfig({
  // ... other config
  plugins: [
    // ... other plugins
    {
      resolve: "medusa-payment-phonepe",
      options: {
        redirectUrl:
          process.env.PHONEPE_REDIRECT_URL ||
          "http://localhost:8000/api/payment-confirmed",
        callbackUrl:
          process.env.PHONEPE_CALLBACK_URL ||
          "http://localhost:9000/phonepe/hooks",
        salt: process.env.PHONEPE_SALT,
        merchantId: process.env.PHONEPE_MERCHANT_ID,
        clientId: process.env.PHONEPE_CLIENT_ID,
        clientSecret: process.env.PHONEPE_CLIENT_SECRET,
        clientVersion: 1, // PhonePe client version (typically 1)
        mode:
          (process.env.PHONEPE_MODE as "production" | "uat" | "test") || "test",
        merchantUsername: process.env.PHONEPE_MERCHANT_USERNAME, // Required for webhook validation
        merchantPassword: process.env.PHONEPE_MERCHANT_PASSWORD, // Required for webhook validation
        tokenCacheEnabled: true, // Optional: Enable OAuth token caching (default: true)
        enabledDebugLogging: false, // Optional: Enable debug logging
      },
    },
  ],
});
```

### Configuration Options

| Option                | Type    | Required    | Description                                                           |
| --------------------- | ------- | ----------- | --------------------------------------------------------------------- |
| `redirectUrl`         | string  | Yes         | URL to redirect customers after payment                               |
| `callbackUrl`         | string  | Yes         | Server-to-server webhook callback URL                                 |
| `salt`                | string  | Yes         | PhonePe provided salt key (legacy, kept for backward compatibility)   |
| `merchantId`          | string  | Yes         | Your PhonePe merchant ID                                              |
| `clientId`            | string  | Yes         | OAuth client ID for PhonePe API v2                                    |
| `clientSecret`        | string  | Yes         | OAuth client secret for PhonePe API v2                                |
| `clientVersion`       | number  | Yes         | PhonePe client version (typically 1)                                  |
| `mode`                | string  | Yes         | `production`, `uat`, or `test`                                        |
| `merchantUsername`    | string  | Recommended | Merchant username for webhook validation (recommended for production) |
| `merchantPassword`    | string  | Recommended | Merchant password for webhook validation (recommended for production) |
| `tokenCacheEnabled`   | boolean | No          | Enable OAuth token caching (default: `true`)                          |
| `enabledDebugLogging` | boolean | No          | Enable debug logging (default: `false`)                               |

## API Endpoints

The plugin uses PhonePe Payment Gateway API v2 with the following endpoints:

- **Payment Creation**: `/checkout/v2/pay`
- **Order Status**: `/checkout/v2/order/{merchantOrderId}/status`
- **Refund**: `/checkout/v2/refund`
- **OAuth Token**: `/v1/oauth/token`

## Webhook Events

The plugin supports the following PhonePe webhook events:

- `checkout.order.completed` (PG_ORDER_COMPLETED) - Payment succeeded
- `checkout.order.failed` (PG_ORDER_FAILED) - Payment failed
- `pg.refund.completed` (PG_REFUND_COMPLETED) - Refund completed
- `pg.refund.failed` (PG_REFUND_FAILED) - Refund failed

### Webhook Validation

The plugin uses PhonePe's official SDK (`pg-sdk-node`) for webhook validation. The SDK's `validateCallback` method is used to verify the authenticity of webhook callbacks from PhonePe.

**Recommended Configuration:**

- Set `merchantUsername` and `merchantPassword` in your configuration to enable SDK-based webhook validation
- The plugin will automatically use the SDK's validation method when these credentials are provided
- If credentials are not provided, the plugin falls back to legacy signature-based validation

**Webhook Endpoint:**

- Default endpoint: `/phonepe/hooks`
- Configure this URL in your PhonePe merchant dashboard as the callback URL

## Migration from v1.x to v2.x

### Breaking Changes

1. **MedusaJS Version**: Requires MedusaJS v2.x (no backward compatibility with v1.x)
2. **OAuth Authentication**: PhonePe API v2 requires OAuth authentication (clientId and clientSecret)
3. **API Endpoints**: Updated to PhonePe API v2 endpoints
4. **Configuration**: New required fields (`clientId`, `clientSecret`)

### Migration Steps

1. **Upgrade MedusaJS**: Ensure your MedusaJS installation is upgraded to v2.x

2. **Update Plugin Version**: Install the latest version of the plugin:

   ```bash
   yarn add medusa-payment-phonepe@^2.0.0
   ```

3. **Obtain OAuth Credentials**: Get your OAuth Client ID and Client Secret from PhonePe dashboard

4. **Update Configuration**: Add OAuth credentials to your plugin configuration:

   ```typescript
   {
     resolve: "medusa-payment-phonepe",
     options: {
       // ... existing options
       clientId: process.env.PHONEPE_CLIENT_ID, // NEW
       clientSecret: process.env.PHONEPE_CLIENT_SECRET, // NEW
     },
   }
   ```

5. **Update Environment Variables**: Add OAuth credentials to your `.env` file

6. **Test Integration**: Test the payment flow in UAT mode before going to production

## Client-Side Integration

### Next.js Example

For Next.js applications, create a payment confirmation route:

```typescript
// app/api/payment-confirmed/route.ts
import { NextRequest, NextResponse } from "next/server";
import { medusaClient } from "@lib/config";

export async function POST(request: NextRequest) {
  const data = await request.formData();
  const merchantOrderId = data.get("merchantOrderId") as string;
  const code = data.get("code") as string;

  if (!merchantOrderId || code !== "SUCCESS") {
    return NextResponse.redirect(new URL("/cart", request.url));
  }

  // Extract cart ID from merchantOrderId (format: cartId_sequence)
  const cartIdParts = merchantOrderId.split("_");
  const cartId = `${cartIdParts[0]}_${cartIdParts[1]}`;

  try {
    // Wait for order to be created by webhook
    let orderId;
    let attempts = 0;
    while (!orderId && attempts < 10) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      try {
        const order = await medusaClient.orders.retrieveByCartId(cartId);
        orderId = order.order.id;
      } catch (e) {
        attempts++;
      }
    }

    if (orderId) {
      return NextResponse.redirect(
        new URL(`/order/confirmed/${orderId}`, request.url)
      );
    }
  } catch (error) {
    console.error("Payment confirmation error:", error);
  }

  return NextResponse.redirect(new URL("/cart", request.url));
}
```

## Features

- ✅ OAuth authentication for PhonePe API v2
- ✅ Automatic token caching and refresh
- ✅ Payment initiation and status checking
- ✅ Webhook handling for payment events
- ✅ Refund support
- ✅ Multiple payment modes (UPI, Cards, Net Banking)
- ✅ UAT and Production mode support

## Testing

### UAT Mode

Set `mode: "uat"` in your configuration to test against PhonePe's UAT environment:

```typescript
{
  mode: "uat",
  // ... other options
}
```

### Test Mode

Set `mode: "test"` for local testing (mocked responses).

## Troubleshooting

### OAuth Token Issues

If you encounter OAuth authentication errors:

1. Verify your `clientId` and `clientSecret` are correct
2. Check that your PhonePe account has API access enabled
3. Ensure your environment variables are properly loaded

### Webhook Issues

If webhooks are not being received:

1. Verify your `callbackUrl` is publicly accessible
2. Check webhook signature verification
3. Ensure your `salt` key matches PhonePe dashboard

### Payment Status Issues

If payment status checks fail:

1. Verify the `merchantOrderId` format
2. Check that the order exists in PhonePe system
3. Review debug logs (enable `enabledDebugLogging: true`)

## Contributing

Pull requests are welcome! For major changes, please open an issue first to discuss what you would like to change.

Please make sure to:

- Update tests as appropriate
- Follow the existing code style
- Update documentation for any API changes

## License

[MIT](https://choosealicense.com/licenses/mit/)

## Support

For issues and questions:

- Open an issue on GitHub
- Check the [PhonePe Developer Documentation](https://developer.phonepe.com)
- Review the [MedusaJS Documentation](https://docs.medusajs.com)

## Disclaimer

The code was tested on a limited number of usage scenarios. There may be unforeseen bugs. Please raise issues as they come, or create pull requests if you'd like to submit fixes.
