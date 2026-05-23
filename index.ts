const server = Bun.serve({
    routes: {
        "/": () => new Response("Kodevagt 0.0.1"),
    }
});

console.log(`Server running at ${server.url}`);