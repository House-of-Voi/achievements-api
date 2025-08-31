const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8"/>
    <title>API Docs</title>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist/swagger-ui.css" />
    <style>body{margin:0} #swagger-ui{min-height:100vh}</style>
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist/swagger-ui-bundle.js"></script>
    <script>
      window.onload = () => {
        window.ui = SwaggerUIBundle({
          url: '/api/openapi',
          dom_id: '#swagger-ui',
          deepLinking: true,
          docExpansion: 'list'
        });
      };
    </script>
  </body>
</html>`;

export async function GET() {
  return new Response(html, { headers: { 'content-type': 'text/html' } });
}
