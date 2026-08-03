function sendJson(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(payload));
}

function broadcastJson(clients, payload) {
  const encoded = JSON.stringify(payload);
  for (const client of clients) {
    if (client.readyState === 1) client.send(encoded);
  }
}

module.exports = { broadcastJson, sendJson };
