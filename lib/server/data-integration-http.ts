import { DataIntegrationError } from "../data-integrations";
import { ACCOUNT_HEADERS, accountRouteError } from "./account-http";
export function dataIntegrationRouteError(error: unknown) {
  return error instanceof DataIntegrationError
    ? Response.json(
        { code: error.code, error: error.message },
        { status: error.status, headers: ACCOUNT_HEADERS },
      )
    : accountRouteError(error);
}
