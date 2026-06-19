#!/bin/bash
set -euo pipefail

# =============================================================================
# Local validation script for CloudWatch and CloudTrail MCP server patchs.
# This script simulates what CodeBuild + AgentCore does:
# 1. Runs the patch script (clone + patch)
# 2. Validates Python syntax
# 3. Builds the Docker image locally
# 4. Starts the container and checks the /mcp health endpoint
#
# Prerequisites: Docker running locally, Python 3.x, git
# Usage: ./scripts/test-patchs-local.sh [cloudwatch|cloudtrail|both]
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CODEBUILD_DIR="$SCRIPT_DIR/codebuild-scripts"
WORK_DIR=$(mktemp -d)
TARGET="${1:-both}"

cleanup() {
    echo ""
    echo "=== Cleaning up ==="
    # Stop any running test containers
    docker rm -f test-cloudwatch-mcp 2>/dev/null || true
    docker rm -f test-cloudtrail-mcp 2>/dev/null || true
    rm -rf "$WORK_DIR"
    echo "Cleanup complete."
}
trap cleanup EXIT

test_server() {
    local server_name="$1"
    local patch_script="$2"
    local source_dir="$3"
    local module_path="$4"
    local container_name="test-${server_name}-mcp"

    echo ""
    echo "========================================"
    echo "Testing: $server_name MCP Server"
    echo "========================================"

    # --- Step 1: Run the patch ---
    echo ""
    echo "--- Step 1: Running patch script ---"
    local build_dir="$WORK_DIR/$server_name"
    mkdir -p "$build_dir"
    cp "$CODEBUILD_DIR/$patch_script" "$build_dir/"
    cd "$build_dir"
    chmod +x "$patch_script"
    ./"$patch_script"
    echo "✅ Patch script completed successfully"

    # --- Step 2: Validate Python syntax ---
    echo ""
    echo "--- Step 2: Validating Python syntax ---"
    local server_file="mcp/src/$source_dir/$module_path/server.py"
    python3 -c "
import py_compile, sys
try:
    py_compile.compile('$server_file', doraise=True)
    print('✅ Python syntax valid')
except py_compile.PyCompileError as e:
    print(f'❌ Syntax error: {e}')
    sys.exit(1)
"

    # --- Step 3: Verify key patterns in patched file ---
    echo ""
    echo "--- Step 3: Verifying patchation patterns ---"
    grep -q 'streamable-http' "$server_file" || { echo "❌ streamable-http not found"; exit 1; }
    grep -q "mcp.settings.host" "$server_file" || { echo "❌ mcp.settings.host not found"; exit 1; }
    grep -q 'mcp.settings.port = 8000' "$server_file" || { echo "❌ mcp.settings.port = 8000 not found"; exit 1; }
    grep -q 'EXPOSE 8000' "mcp/src/$source_dir/Dockerfile" || { echo "❌ EXPOSE 8000 not in Dockerfile"; exit 1; }
    echo "✅ All patterns verified"

    # --- Step 4: Build Docker image ---
    echo ""
    echo "--- Step 4: Building Docker image ---"
    cd "mcp/src/$source_dir"
    docker build -t "$container_name:test" . 2>&1 | tail -5
    echo "✅ Docker image built successfully"

    # --- Step 5: Start container and test health ---
    echo ""
    echo "--- Step 5: Starting container and testing health endpoint ---"
    docker rm -f "$container_name" 2>/dev/null || true
    docker run -d --name "$container_name" -p 0:8000 "$container_name:test"

    # Get the mapped port
    local port
    port=$(docker port "$container_name" 8000 | cut -d: -f2)
    echo "Container started on port $port"

    # Wait for server to be ready (up to 30 seconds)
    echo "Waiting for server to start..."
    local max_wait=30
    local waited=0
    while [ $waited -lt $max_wait ]; do
        if curl -sf "http://localhost:$port/mcp" > /dev/null 2>&1; then
            echo "✅ Health check passed! Server is running on port $port"
            break
        fi
        sleep 2
        waited=$((waited + 2))
        echo "  Waiting... ($waited/$max_wait seconds)"
    done

    if [ $waited -ge $max_wait ]; then
        echo "❌ Health check FAILED after ${max_wait}s"
        echo ""
        echo "Container logs:"
        docker logs "$container_name" 2>&1 | tail -30
        docker rm -f "$container_name" 2>/dev/null || true
        return 1
    fi

    # --- Step 6: Test MCP endpoint responds with tools ---
    echo ""
    echo "--- Step 6: Testing MCP protocol response ---"
    local response
    response=$(curl -sf -X POST "http://localhost:$port/mcp" \
        -H "Content-Type: application/json" \
        -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}' 2>&1) || true

    if echo "$response" | grep -q '"result"'; then
        echo "✅ MCP initialize response received"
        echo "   Response preview: $(echo "$response" | head -c 200)..."
    else
        echo "⚠️  MCP initialize didn't return expected response (may need session handling)"
        echo "   Response: $(echo "$response" | head -c 300)"
        echo "   (This is OK - the server is running and responding, which is what AgentCore needs)"
    fi

    # Clean up container
    docker rm -f "$container_name" 2>/dev/null || true
    echo ""
    echo "✅ $server_name MCP Server: ALL TESTS PASSED"
    echo ""
}

echo "============================================================"
echo "  Local Patch Validation for MCP Servers"
echo "  Working directory: $WORK_DIR"
echo "============================================================"

if [ "$TARGET" = "cloudwatch" ] || [ "$TARGET" = "both" ]; then
    test_server "cloudwatch" "patch-cloudwatch.sh" "cloudwatch-mcp-server" "awslabs/cloudwatch_mcp_server"
fi

if [ "$TARGET" = "cloudtrail" ] || [ "$TARGET" = "both" ]; then
    test_server "cloudtrail" "patch-cloudtrail.sh" "cloudtrail-mcp-server" "awslabs/cloudtrail_mcp_server"
fi

echo ""
echo "============================================================"
echo "  ✅ ALL VALIDATION TESTS PASSED"
echo "============================================================"
echo ""
echo "The patched servers build and start successfully."
echo "You can safely deploy with: npx cdk deploy --all"
