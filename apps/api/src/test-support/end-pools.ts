import type { Pool } from 'pg';

// pool.end() resolves before its sockets close; wait for every client to leave so a container stop cannot terminate one mid-goodbye.
export async function endPools(...pools: Pool[]): Promise<void> {
  await Promise.all(
    pools.map(async (pool) => {
      const closed = new Promise<void>((resolve) => {
        let open = pool.totalCount;

        if (open === 0) {
          resolve();
          return;
        }

        pool.on('remove', () => {
          open -= 1;

          if (open === 0) {
            resolve();
          }
        });
      });

      await pool.end();
      await closed;
    }),
  );
}
