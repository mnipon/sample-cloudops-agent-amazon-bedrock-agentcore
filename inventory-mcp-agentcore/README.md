# Inventory MCP Server for AWS Software Version Management

An MCP Server that provides tools for querying AWS managed service inventory including version info, cluster status, and end-of-support schedules for **EKS, RDS, OpenSearch, ElastiCache, and MSK**.

Designed to run on **Bedrock AgentCore Runtime** and be exposed via **AgentCore Gateway**.

## Tools

### EKS

- `list_eks_clusters` – List all EKS clusters with versions and end-of-support dates
- `get_eks_cluster_detail` – Detailed cluster info including addons and nodegroups
- `get_eks_supported_versions` – EKS version lifecycle/end-of-support schedule

### RDS

- `list_rds_instances` – List all RDS DB instances with engine versions
- `list_rds_clusters` – List all Aurora DB clusters
- `get_rds_engine_versions` – Available engine versions for a given engine

### OpenSearch

- `list_opensearch_domains` – List all OpenSearch domains with versions
- `get_opensearch_compatible_versions` – Upgrade path compatibility
- `list_opensearch_versions` – All available engine versions

### ElastiCache

- `list_elasticache_clusters` – List all ElastiCache clusters
- `list_elasticache_replication_groups` – List replication groups (Redis/Valkey)
- `get_elasticache_engine_versions` – Available engine versions

### MSK

- `list_msk_clusters` – List all MSK (Kafka) clusters
- `get_msk_cluster_detail` – Detailed MSK cluster information
- `get_msk_compatible_kafka_versions` – Compatible Kafka version upgrades

## End-of-Support (EOL) Data Pipeline

End-of-support dates are produced by a separate scraper (`eol-scraper/`) that runs
as a Lambda on a daily EventBridge schedule and writes results to the
`aws-eol-schedules` DynamoDB table. The MCP server reads from this table at runtime
(with a short TTL cache) to enrich version listings with
`end_of_standard_support` and `end_of_extended_support` dates.

### Data Sources by Service

| Service                              | Source                                            | Notes                                                                |
| ------------------------------------ | ------------------------------------------------- | -------------------------------------------------------------------- |
| EKS                                  | `eks:DescribeClusterVersions` API                 | Dates returned directly by the API                                   |
| RDS MySQL / PostgreSQL / MariaDB     | AWS docs (version management + release calendars) | Scrapes both major and minor version tables                          |
| Aurora MySQL / PostgreSQL            | AWS docs (release calendars)                      | Scrapes both major and minor version tables                          |
| ElastiCache (Redis/Valkey/Memcached) | `engine-versions.html` + API                      | Major version EOL table                                              |
| OpenSearch / Elasticsearch           | `what-is.html` + `ListVersions` API               | Version ranges (e.g. "1.0 through 1.2") matched to concrete versions |
| MSK (Kafka)                          | `supported-kafka-versions.html` + API             | Standard support only; extended support is `N/A`                     |

### Date Field Semantics

- `end_of_standard_support` – the **RDS/AWS end of standard support date**.
- `end_of_extended_support` – the **end of extended support date** (the final EOL).
  - Scrapers strictly match the _"end of extended support"_ column and never the
    _"start of extended support … pricing"_ columns, which are start dates.
  - Services without an extended-support tier (e.g. MSK) report `N/A`.
  - Unparseable or unannounced values (e.g. "To be determined", "Not announced")
    resolve to `Unknown`.

### Runtime Verification Loop

All scrapers route their output through a shared verification module
(`eol_scraper/verification.py`) before the data is written to DynamoDB. It follows
a **warn-and-continue** philosophy (logs issues, never halts the scraper) and runs:

1. **Date format validation** – non `YYYY-MM-DD` values are reset to `Unknown`.
2. **Date range plausibility** – years outside a configurable range are reset to `Unknown`.
3. **Chronological sanity** – warns if `end_of_extended_support` precedes `end_of_standard_support`.
4. **Coverage threshold** – warns if too few API-known versions received scraped dates
   (signals an upstream documentation structure change).
5. **Cross-source deduplication** – on conflicting dates for the same version, keeps the
   first-seen value. Deduplication is scoped per service so the same version number across
   engines (e.g. Redis 7.0 vs Valkey 7.0) is never treated as a conflict.

The sentinel values `Unknown` and `N/A` are preserved and never flagged as invalid.

### Configuration (environment variables)

| Variable                 | Default             | Description                                                     |
| ------------------------ | ------------------- | --------------------------------------------------------------- |
| `EOL_TABLE_NAME`         | `aws-eol-schedules` | DynamoDB table for EOL data                                     |
| `EOL_CACHE_TTL`          | `300`               | MCP server cache TTL (seconds) for DynamoDB reads               |
| `EOL_COVERAGE_THRESHOLD` | `0.50`              | Minimum fraction of API versions expected to have scraped dates |
| `EOL_MIN_YEAR`           | `2020`              | Earliest plausible EOL year                                     |
| `EOL_MAX_YEAR`           | `2035`              | Latest plausible EOL year                                       |

### Running the scraper locally

```bash
cd eol-scraper
AWS_REGION=us-east-1 EOL_TABLE_NAME=aws-eol-schedules python -m eol_scraper.main
```

## Local Development

```bash
# Install dependencies
uv pip install -e .

# Run with stdio transport (for MCP clients like Kiro, Cursor)
inventory-mcp-server

# Run with streamable-http transport (for AgentCore Runtime)
MCP_TRANSPORT=streamable-http inventory-mcp-server
```

## Deployment to Bedrock AgentCore Runtime

### 1. Build and push container image

> The Dockerfile uses the ECR Public mirror of the official Python image
> (`public.ecr.aws/docker/library/python`) instead of Docker Hub to avoid
> anonymous pull rate limits (HTTP 429) during CodeBuild.

```bash
# Build
docker build -t inventory-mcp-server .

# Tag and push to ECR
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin <account>.dkr.ecr.us-east-1.amazonaws.com
docker tag inventory-mcp-server:latest <account>.dkr.ecr.us-east-1.amazonaws.com/inventory-mcp-server:latest
docker push <account>.dkr.ecr.us-east-1.amazonaws.com/inventory-mcp-server:latest
```

### 2. Register as AgentCore Runtime MCP Server

```bash
aws bedrock-agentcore create-mcp-server \
  --name inventory-mcp-server \
  --container-config '{
    "imageUri": "<account>.dkr.ecr.us-east-1.amazonaws.com/inventory-mcp-server:latest",
    "port": 8000,
    "environment": {
      "MCP_TRANSPORT": "streamable-http",
      "AWS_REGION": "us-east-1"
    }
  }'
```

### 3. Expose via AgentCore Gateway

Configure AgentCore Gateway to route to the MCP server endpoint. The server exposes streamable-http transport on port 8000.

## MCP Client Configuration (stdio mode)

```json
{
  "mcpServers": {
    "inventory-mcp-server": {
      "command": "inventory-mcp-server",
      "env": {
        "AWS_REGION": "us-east-1",
        "AWS_PROFILE": "your-profile"
      }
    }
  }
}
```

## Required IAM Permissions

### MCP Server runtime role (read-only)

- `eks:ListClusters`, `eks:DescribeCluster`, `eks:ListAddons`, `eks:ListNodegroups`
- `rds:DescribeDBInstances`, `rds:DescribeDBClusters`, `rds:DescribeDBEngineVersions`
- `es:ListDomainNames`, `es:DescribeDomains`, `es:GetCompatibleVersions`, `es:ListVersions`
- `elasticache:DescribeCacheClusters`, `elasticache:DescribeReplicationGroups`, `elasticache:DescribeCacheEngineVersions`
- `kafka:ListClustersV2`, `kafka:DescribeClusterV2`, `kafka:GetCompatibleKafkaVersions`
- `dynamodb:GetItem`, `dynamodb:Query`, `dynamodb:Scan` (on the EOL table)

### EOL scraper Lambda role

- `eks:DescribeClusterVersions`
- `rds:DescribeDBEngineVersions` (MySQL, PostgreSQL, MariaDB, Aurora MySQL, Aurora PostgreSQL)
- `es:ListVersions`, `es:ListElasticsearchVersions`
- `elasticache:DescribeCacheEngineVersions`
- `kafka:GetCompatibleKafkaVersions`
- `dynamodb:PutItem`, `dynamodb:BatchWriteItem`, `dynamodb:CreateTable`, `dynamodb:DescribeTable` (on the EOL table)
- Outbound HTTPS to `docs.aws.amazon.com` for documentation scraping
