-- Name the MCP client reported when it connected (clientInfo.name in `initialize`), so actions
-- through a token show which AI tool did them even when the token was not made by `mcp install`.
ALTER TABLE api_tokens ADD COLUMN mcp_client TEXT;
