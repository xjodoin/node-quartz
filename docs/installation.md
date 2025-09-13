# Installation

It's on NPM:

```bash
npm install node-quartz
```

## Requirements
- Node.js >= 14
- Redis 6.x+ recommended (keyspace notifications with `Ex`)

Enable keyspace notifications for expired events:

```bash
redis-server --notify-keyspace-events Ex
# or at runtime
redis-cli CONFIG SET notify-keyspace-events Ex
```
