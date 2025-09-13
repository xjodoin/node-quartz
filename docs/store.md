# Job Store

Use a store to preload and synchronize job definitions across instances. The scheduler persists definitions in Redis and schedules them locally.

## Memory Store
```js
create({ store: { type: 'memory', jobs: [ /* Job objects */ ] } });
```

## File Store
`jobs.json` should contain an array of Job objects.
```js
create({ store: { type: 'file', path: './jobs.json' } });
```

## Custom Store
Provide an object implementing `load/list/save/remove`.
```js
const myStore = { async load() { return [...]; }, async list(){...}, async save(job){...}, async remove(id){...} };
create({ store: { type: 'custom', impl: myStore } });
```

## Redis Keys
- `<prefix>:defs:index` — set of job ids
- `<prefix>:defs:<id>` — stringified Job
- `<prefix>:defs:events` — pub/sub channel: `{action:'upsert'|'remove'|'reload', id?}`
