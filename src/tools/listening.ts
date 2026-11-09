import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ApiClient } from "../services/api-client.js";
import {
  buildEqFilter,
  buildDateRangeFilter,
  buildTextMatchFilter,
  buildExistsFilter,
} from "../services/filter-builder.js";
import { formatAsTable, formatOutput, truncateIfNeeded, safeToolCall } from "../services/formatter.js";
import {
  ResponseFormatSchema,
  CustomerIdSchema,
  PageSchema,
  DateSchema,
  SortOrderSchema,
  TimezoneSchema,
} from "../schemas/common.js";
import type { SproutApiResponse, ToolResponse, ResponseFormat } from "../types.js";

interface ListeningFilterParams {
  sentiment?: "positive" | "negative" | "neutral" | "unclassified";
  networks?: string[];
  text_search?: string;
  language?: string[];
  explicit_label?: boolean;
  has_visual_media?: boolean;
  distribution_type?: string[];
  theme_ids?: number[];
  location_country?: string[];
  location_province?: string[];
  location_city?: string[];
  additional_filters?: string[];
}

interface ListeningMessagesParams extends ListeningFilterParams {
  topic_id: string;
  start_date: string;
  end_date: string;
  fields: string[];
  metrics?: string[];
  sort_by?: string;
  sort_order?: "asc" | "desc";
  timezone?: string;
  page?: number;
  limit?: number;
  response_format: ResponseFormat;
}

interface ListeningMetricsParams extends ListeningFilterParams {
  topic_id: string;
  start_date: string;
  end_date: string;
  metrics?: string[];
  dimensions?: string[];
  timezone?: string;
  limit?: number;
  response_format: ResponseFormat;
}

function buildListeningFilters(params: ListeningFilterParams): string[] {
  const filters: string[] = [];
  if (params.sentiment) {
    filters.push(buildEqFilter("sentiment", [params.sentiment]));
  }
  if (params.networks && params.networks.length > 0) {
    filters.push(buildEqFilter("network", params.networks));
  }
  if (params.text_search) {
    filters.push(buildTextMatchFilter("text", params.text_search));
  }
  if (params.language && params.language.length > 0) {
    filters.push(buildEqFilter("language", params.language));
  }
  if (params.explicit_label !== undefined) {
    filters.push(buildExistsFilter("explicit_label", params.explicit_label));
  }
  if (params.has_visual_media !== undefined) {
    filters.push(buildExistsFilter("visual_media", params.has_visual_media));
  }
  if (params.distribution_type && params.distribution_type.length > 0) {
    filters.push(buildEqFilter("distribution_type", params.distribution_type));
  }
  if (params.theme_ids && params.theme_ids.length > 0) {
    filters.push(buildEqFilter("document.theme_ids", params.theme_ids));
  }
  if (params.location_country && params.location_country.length > 0) {
    filters.push(buildEqFilter("location.country", params.location_country));
  }
  if (params.location_province && params.location_province.length > 0) {
    filters.push(buildEqFilter("location.province", params.location_province));
  }
  if (params.location_city && params.location_city.length > 0) {
    filters.push(buildEqFilter("location.city", params.location_city));
  }
  if (params.additional_filters && params.additional_filters.length > 0) {
    filters.push(...params.additional_filters);
  }
  return filters;
}

export async function handleListeningMessages(
  client: ApiClient,
  customerId: number,
  params: ListeningMessagesParams
): Promise<ToolResponse> {
  const filters: string[] = [
    buildDateRangeFilter("created_time", params.start_date, params.end_date, false),
    ...buildListeningFilters(params),
  ];

  const sortOrder = params.sort_order ?? "desc";
  const sortBy = params.sort_by ?? "created_time";
  const body: Record<string, unknown> = {
    filters,
    sort: [`${sortBy}:${sortOrder}`],
  };

  body.fields = params.fields;
  if (params.metrics !== undefined) body.metrics = params.metrics;
  if (params.timezone !== undefined) body.timezone = params.timezone;
  if (params.page !== undefined) body.page = params.page;
  if (params.limit !== undefined) body.limit = params.limit;

  const response = await client.post<SproutApiResponse<object>>(
    `/v1/${customerId}/listening/topics/${params.topic_id}/messages`,
    body
  );

  const paging = response.paging as { current_page?: number; total_pages?: number } | undefined;
  const text = formatOutput(
    response.data,
    params.response_format,
    (data) => formatAsTable(data as object[], params.fields),
    paging
  );
  return { content: [{ type: "text" as const, text: truncateIfNeeded(text) }] };
}

export async function handleListeningMetrics(
  client: ApiClient,
  customerId: number,
  params: ListeningMetricsParams
): Promise<ToolResponse> {
  const filters: string[] = [
    buildDateRangeFilter("created_time", params.start_date, params.end_date, false),
    ...buildListeningFilters(params),
  ];

  const body: Record<string, unknown> = { filters };

  if (params.metrics !== undefined) body.metrics = params.metrics;
  if (params.dimensions !== undefined) body.dimensions = params.dimensions;
  if (params.timezone !== undefined) body.timezone = params.timezone;
  if (params.limit !== undefined) body.limit = params.limit;

  const response = await client.post<SproutApiResponse<object>>(
    `/v1/${customerId}/listening/topics/${params.topic_id}/metrics`,
    body
  );

  const columns = [
    ...(params.dimensions ?? []),
    ...(params.metrics ?? []),
  ];
  const text = formatOutput(response.data, params.response_format, (data) =>
    formatAsTable(data as object[], columns.length > 0 ? columns : ["created_time"])
  );
  return { content: [{ type: "text" as const, text: truncateIfNeeded(text) }] };
}

const TOOL_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

export function registerListeningTools(
  server: McpServer,
  client: ApiClient,
  defaultCustomerId: number
): void {
  server.registerTool(
    "sprout_get_listening_messages",
    {
      title: "Get Listening Messages",
      description:
        "Query social listening messages for a topic with optional filters for sentiment, network, and text search. Supports index-based pagination.",
      inputSchema: z
        .object({
          customer_id: CustomerIdSchema,
          topic_id: z.coerce.string().min(1).describe("Listening topic ID (UUID string from sprout_list_topics)"),
          start_date: DateSchema.describe("Start of date range (inclusive)"),
          end_date: DateSchema.describe("End of date range (exclusive)"),
          sentiment: z
            .enum(["positive", "negative", "neutral", "unclassified"])
            .optional()
            .describe("Filter by sentiment"),
          networks: z.array(z.string()).optional().describe("Filter by networks (e.g. ['TWITTER', 'INSTAGRAM', 'TIKTOK', 'BLUESKY'])"),
          text_search: z
            .string()
            .optional()
            .describe("Full-text search (supports OR operator)"),
          language: z.array(z.string()).optional().describe("Filter by language codes (e.g. ['en', 'es'])"),
          explicit_label: z.boolean().optional().describe("Filter by explicit content presence (true = has explicit content)"),
          has_visual_media: z.boolean().optional().describe("Filter by visual media presence"),
          theme_ids: z.array(z.number()).optional().describe("Filter by theme IDs within the topic"),
          distribution_type: z.array(z.string()).optional().describe("Filter by distribution type"),
          location_country: z.array(z.string()).optional().describe("Filter by country"),
          location_province: z.array(z.string()).optional().describe("Filter by province/state"),
          location_city: z.array(z.string()).optional().describe("Filter by city"),
          additional_filters: z.array(z.string()).optional().describe("Extra Sprout DSL filter strings for advanced filtering (e.g. 'likes.gt(10)', 'engagements.gte(5)')"),
          fields: z.array(z.string()).min(1).describe("Fields to return (at least one required, e.g. 'text', 'created_time', 'network')"),
          metrics: z.array(z.string()).optional().describe("Metric names to return alongside fields (e.g. 'engagements', 'likes', 'from.followers_count')"),
          sort_by: z.string().optional().describe("Field to sort by"),
          sort_order: SortOrderSchema,
          timezone: TimezoneSchema,
          page: PageSchema,
          limit: z.number().int().min(1).max(100).default(50).describe("Results per page"),
          response_format: ResponseFormatSchema,
        })
        .strict(),
      annotations: TOOL_ANNOTATIONS,
    },
    async (params) => safeToolCall(() => {
      const cid = params.customer_id ?? defaultCustomerId;
      return handleListeningMessages(client, cid, {
        topic_id: params.topic_id,
        start_date: params.start_date,
        end_date: params.end_date,
        sentiment: params.sentiment,
        networks: params.networks,
        text_search: params.text_search,
        language: params.language,
        explicit_label: params.explicit_label,
        has_visual_media: params.has_visual_media,
        theme_ids: params.theme_ids,
        distribution_type: params.distribution_type,
        location_country: params.location_country,
        location_province: params.location_province,
        location_city: params.location_city,
        additional_filters: params.additional_filters,
        fields: params.fields,
        metrics: params.metrics,
        sort_by: params.sort_by,
        sort_order: params.sort_order,
        timezone: params.timezone,
        page: params.page,
        limit: params.limit,
        response_format: params.response_format,
      });
    })
  );

  server.registerTool(
    "sprout_get_listening_metrics",
    {
      title: "Get Listening Metrics",
      description:
        "Query aggregated metrics for a listening topic over a date range. Returns all data in a single response (no pagination).",
      inputSchema: z
        .object({
          customer_id: CustomerIdSchema,
          topic_id: z.coerce.string().min(1).describe("Listening topic ID (UUID string from sprout_list_topics)"),
          start_date: DateSchema.describe("Start of date range (inclusive)"),
          end_date: DateSchema.describe("End of date range (exclusive)"),
          networks: z.array(z.string()).optional().describe("Filter metrics by networks"),
          sentiment: z.enum(["positive", "negative", "neutral", "unclassified"]).optional().describe("Filter metrics by sentiment"),
          text_search: z.string().optional().describe("Filter metrics by text search (supports OR operator)"),
          language: z.array(z.string()).optional().describe("Filter by language codes (e.g. ['en', 'es'])"),
          explicit_label: z.boolean().optional().describe("Filter by explicit content presence"),
          has_visual_media: z.boolean().optional().describe("Filter by visual media presence"),
          distribution_type: z.array(z.string()).optional().describe("Filter by distribution type"),
          theme_ids: z.array(z.number()).optional().describe("Filter by theme IDs within the topic"),
          location_country: z.array(z.string()).optional().describe("Filter by country"),
          location_province: z.array(z.string()).optional().describe("Filter by province/state"),
          location_city: z.array(z.string()).optional().describe("Filter by city"),
          additional_filters: z.array(z.string()).optional().describe("Extra Sprout DSL filter strings for advanced filtering (e.g. 'likes.gt(10)')"),
          metrics: z.array(z.string()).optional().describe("Metric names to return"),
          dimensions: z
            .array(z.string())
            .optional()
            .describe("Dimension expressions (e.g. 'created_time.by(day)')"),
          timezone: TimezoneSchema,
          limit: z.number().int().min(1).optional().describe("Maximum number of results"),
          response_format: ResponseFormatSchema,
        })
        .strict(),
      annotations: TOOL_ANNOTATIONS,
    },
    async (params) => safeToolCall(() => {
      const cid = params.customer_id ?? defaultCustomerId;
      return handleListeningMetrics(client, cid, {
        topic_id: params.topic_id,
        start_date: params.start_date,
        end_date: params.end_date,
        networks: params.networks,
        sentiment: params.sentiment,
        text_search: params.text_search,
        language: params.language,
        explicit_label: params.explicit_label,
        has_visual_media: params.has_visual_media,
        distribution_type: params.distribution_type,
        theme_ids: params.theme_ids,
        location_country: params.location_country,
        location_province: params.location_province,
        location_city: params.location_city,
        additional_filters: params.additional_filters,
        metrics: params.metrics,
        dimensions: params.dimensions,
        timezone: params.timezone,
        limit: params.limit,
        response_format: params.response_format,
      });
    })
  );

  server.registerTool(
    "sprout_analyze_listening_trends",
    {
      title: "Analyze Listening Trends",
      description: "Compiles daily listening volume trends, sentiment distributions, and network share distributions for a listening topic.",
      inputSchema: z
        .object({
          customer_id: CustomerIdSchema,
          topic_id: z.coerce.string().min(1).describe("Listening topic ID (UUID string from sprout_list_topics)"),
          start_date: DateSchema.describe("Start of date range (inclusive)"),
          end_date: DateSchema.describe("End of date range (exclusive)"),
          response_format: ResponseFormatSchema,
        })
        .strict(),
      annotations: TOOL_ANNOTATIONS,
    },
    async (params) => safeToolCall(() => {
      const cid = params.customer_id ?? defaultCustomerId;
      return handleAnalyzeListeningTrends(client, cid, {
        topic_id: params.topic_id,
        start_date: params.start_date,
        end_date: params.end_date,
        response_format: params.response_format,
      });
    })
  );
}

interface AnalyzeListeningTrendsParams {
  topic_id: string;
  start_date: string;
  end_date: string;
  response_format: ResponseFormat;
}

export async function handleAnalyzeListeningTrends(
  client: ApiClient,
  customerId: number,
  params: AnalyzeListeningTrendsParams
): Promise<ToolResponse> {
  const baseFilters = [
    buildDateRangeFilter("created_time", params.start_date, params.end_date, false),
  ];

  const dailyResponse = await client.post<SproutApiResponse<any>>(
    `/v1/${customerId}/listening/topics/${params.topic_id}/metrics`,
    {
      filters: baseFilters,
      metrics: ["volume"],
      dimensions: ["created_time.by(day)"],
    }
  );

  const sentimentResponse = await client.post<SproutApiResponse<any>>(
    `/v1/${customerId}/listening/topics/${params.topic_id}/metrics`,
    {
      filters: baseFilters,
      metrics: ["volume"],
      dimensions: ["sentiment"],
    }
  );

  const networkResponse = await client.post<SproutApiResponse<any>>(
    `/v1/${customerId}/listening/topics/${params.topic_id}/metrics`,
    {
      filters: baseFilters,
      metrics: ["volume"],
      dimensions: ["network"],
    }
  );

  if (params.response_format === "json") {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              daily_trend: dailyResponse.data,
              sentiment_breakdown: sentimentResponse.data,
              network_breakdown: networkResponse.data,
            },
            null,
            2
          ),
        },
      ],
    };
  }

  const dailyTable = formatAsTable(dailyResponse.data, ["created_time.by(day)", "volume"]);
  const sentimentTable = formatAsTable(sentimentResponse.data, ["sentiment", "volume"]);
  const networkTable = formatAsTable(networkResponse.data, ["network", "volume"]);

  const reportText = [
    `# Social Listening Trend Analysis Report`,
    `**Topic ID**: ${params.topic_id}`,
    `**Analysis Window**: ${params.start_date} to ${params.end_date}`,
    ``,
    `## Daily Message Volume Trend`,
    dailyTable,
    ``,
    `## Sentiment Breakdown`,
    sentimentTable,
    ``,
    `## Network Distribution`,
    networkTable,
  ].join("\n");

  return { content: [{ type: "text" as const, text: truncateIfNeeded(reportText) }] };
}
