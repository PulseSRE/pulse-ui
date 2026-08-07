export function SourceBadge({ source, mcpServer }: { source?: string; mcpServer?: string }) {
  if (source === 'mcp') {
    return (
      <span
        className="text-[10px] px-1 py-0.5 rounded-sm bg-cyan-900/30 text-cyan-400 border border-cyan-800/30 cursor-default"
        title={mcpServer ? `MCP server: ${mcpServer}` : 'MCP tool'}
      >
        mcp
      </span>
    );
  }
  return (
    <span className="text-[10px] px-1 py-0.5 rounded-sm bg-blue-900/30 text-blue-400 border border-blue-800/30">
      native
    </span>
  );
}
