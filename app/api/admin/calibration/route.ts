import {
  guardAccountMutation,
  requireOperator,
} from "../../../../lib/server/account-auth";
import {
  ACCOUNT_HEADERS,
  accountBody,
  accountRouteError,
} from "../../../../lib/server/account-http";
import { AccountDataError } from "../../../../lib/account/validation";
import {
  calibrationStore,
  CalibrationUnavailable,
  parseCalibrationExperiment,
} from "../../../../lib/server/calibration-store";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
function failure(error: unknown) {
  return error instanceof CalibrationUnavailable
    ? Response.json(
        { error: error.message, code: error.code },
        { status: 503, headers: ACCOUNT_HEADERS },
      )
    : accountRouteError(error);
}
export async function GET(request: Request) {
  try {
    await requireOperator(request);
    if (new URL(request.url).search)
      throw new AccountDataError(
        "calibration_filters_unavailable",
        "Calibration uses prespecified cohorts and metrics. Arbitrary filters are unavailable.",
      );
    return Response.json(await calibrationStore().summary(), {
      headers: ACCOUNT_HEADERS,
    });
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: Request) {
  try {
    guardAccountMutation(request);
    await requireOperator(request);
    if (new URL(request.url).search)
      throw new AccountDataError(
        "calibration_filters_unavailable",
        "Calibration uses prespecified cohorts and metrics.",
      );
    const experiment = parseCalibrationExperiment(
      await accountBody(request, 2000),
    );
    return Response.json(await calibrationStore().summary(experiment), {
      headers: ACCOUNT_HEADERS,
    });
  } catch (error) {
    return failure(error);
  }
}
