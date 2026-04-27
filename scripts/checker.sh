#!/bin/bash
PLUGIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
node "$PLUGIN_DIR/scripts/checker.js"
