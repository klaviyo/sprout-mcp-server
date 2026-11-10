export const BASE_URL = "https://api.sproutsocial.com";

export const OAUTH_TOKEN_ENDPOINT =
  "https://identity.sproutsocial.com/oauth2/84e39c75-d770-45d9-90a9-7b79e3037d2c/v1/token";

export const OAUTH_AUTH_ENDPOINT =
  "https://identity.sproutsocial.com/oauth2/84e39c75-d770-45d9-90a9-7b79e3037d2c/v1/authorize";

// Sprout API: 60 requests/min hard limit, we cap at 55 to stay safe
export const RATE_LIMIT_SOFT_CAP = 55;

export const REQUEST_TIMEOUT_MS = 30_000;

export const MAX_RETRIES = 3;
export const RETRY_BASE_DELAY_MS = 1000;
export const MAX_202_RETRIES = 5;

export const CHARACTER_LIMIT = 25_000;

export const MAX_PROFILES_PER_REQUEST = 100;
export const MAX_MESSAGE_IDS_PER_REQUEST = 100;
export const MAX_CASE_IDS_PER_REQUEST = 100;
export const CASES_MAX_DATE_RANGE_DAYS = 7;
export const ANALYTICS_MAX_DATE_RANGE_DAYS = 365;

export const RETRYABLE_STATUS_CODES = [429, 500, 503, 504];
export const SERVER_VERSION = "1.3.4-klaviyo.2";
