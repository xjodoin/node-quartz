# Architecture

```
            +--------------------------+
            |      Job Store (opt)     |
            |  - memory / file / custom|
            +------------+-------------+
                         | load() / upsert
                         v
                +------------------+
                |      Redis       |
                |------------------|
                | defs:index (SET) |
                | defs:<id> (STR)  |<-- CLI defs:add/remove/reload
                | defs:events (PUB)|----^ 
                |                  |
                | jobs (LIST/KEYS) |<-- enqueue/TTL (:next/:retry)
                | processing (LIST)|
                | failed (LIST)    |<-- CLI failed:*
                | master (KEY)     |
                +--------+---------+
                         ^
      pubsub (events)    |      keyspace events (expired)
   +---------------------+----------------------+
   |                                            |
   v                                            v
+--+----------------+                    +------+---------------+
|  Scheduler A      |                    |  Scheduler B        |
|-------------------|                    |---------------------|
| - master election |<-- heartbeat ----->| - standby/worker    |
| - schedule cron   |                    | - schedule on events|
| - worker loop     |<-- BL/MOVE/RPOP -->| - worker loop       |
| - processors      |                    | - processors        |
+--+----------------+                    +------+---------------+
```
