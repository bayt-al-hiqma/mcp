const envRows = [
  ["MCP_AUTH_TOKEN", "Bearer token required for every MCP request."],
  ["VAULT_BACKEND", "Use github for Vercel deployments or local for development."],
  ["GITHUB_TOKEN", "Server-side token with access to the Markdown vault repository."],
  ["GITHUB_OWNER / GITHUB_REPO / GITHUB_BRANCH", "Repository namespace, storage identifier, and branch target."],
  ["VAULT_ROOT", "Optional root folder inside the repository."],
  ["DAILY_NOTES_DIR / CANONICAL_NOTES_DIR / DECISIONS_DIR", "Generated note folders."],
  ["SEARCH_RESULT_LIMIT / GRAPH_RESULT_LIMIT / MAX_FILE_SIZE_BYTES", "Bounds for context exposure and processing."],
];

export default function Home() {
  return (
    <main className="mx-auto max-w-4xl px-6 py-12 font-sans leading-7">
      <h1 className="text-4xl font-bold tracking-tight">Bayt al-Hiqma Personal Memory MCP</h1>
      <p className="mt-4 text-lg text-gray-700">
        A Vercel-ready JSON-RPC MCP server that lets ChatGPT search, read, and safely update a user-owned Markdown memory vault.
      </p>

      <section className="mt-10">
        <h2 className="text-2xl font-semibold">Endpoints</h2>
        <ul className="mt-3 list-disc pl-6">
          <li><code>POST /api/mcp</code> — authenticated MCP JSON-RPC endpoint.</li>
          <li><code>GET /api/health</code> — configuration health check with no secrets.</li>
          <li><code>GET /api/diagnostics</code> — authenticated redacted diagnostics.</li>
        </ul>
      </section>

      <section className="mt-10">
        <h2 className="text-2xl font-semibold">Required configuration</h2>
        <div className="mt-3 overflow-hidden rounded border">
          <table className="w-full border-collapse text-left text-sm">
            <tbody>
              {envRows.map(([name, description]) => (
                <tr className="border-t" key={name}>
                  <th className="w-72 bg-gray-50 p-3 font-mono align-top">{name}</th>
                  <td className="p-3">{description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-10">
        <h2 className="text-2xl font-semibold">ChatGPT connection</h2>
        <ol className="mt-3 list-decimal pl-6">
          <li>Deploy this app to Vercel with the GitHub vault environment variables set server-side.</li>
          <li>Set <code>MCP_AUTH_TOKEN</code> to a long random secret.</li>
          <li>Configure ChatGPT to call <code>https://your-app.vercel.app/api/mcp</code> with <code>Authorization: Bearer your-token</code>.</li>
          <li>Ask ChatGPT to retrieve before relying on personal context and to write only concise, durable memories.</li>
        </ol>
      </section>

      <section className="mt-10 rounded bg-gray-50 p-5">
        <h2 className="text-2xl font-semibold">Safety model</h2>
        <p className="mt-3">
          Reads are bounded, writes are path-safe, note creation refuses overwrites, section updates and canonical updates use conflict detection, and generated content remains plain Markdown with common frontmatter conventions.
        </p>
      </section>
    </main>
  );
}
