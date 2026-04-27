#!/bin/bash
PLUGIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DP_EVENT="${DP_EVENT:-UserPromptSubmit}" node "$PLUGIN_DIR/scripts/logger.js"
