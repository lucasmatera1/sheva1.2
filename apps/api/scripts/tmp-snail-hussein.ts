import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

// Check if table exists
const tables: any[] = await prisma.$queryRawUnsafe(
  "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME LIKE '%dispatch%'"
);
console.log('Tables with dispatch:', tables.map(t => t.TABLE_NAME));

// Recent Snail dispatches
try {
  const dispatches: any[] = await prisma.$queryRawUnsafe(`
    SELECT id, created_at, confrontation_label, signal_key, rule_id
    FROM alert_method_dispatches
    WHERE confrontation_label LIKE '%Snail%'
    AND created_at >= '2026-03-20 20:00:00'
    ORDER BY created_at DESC
    LIMIT 5
  `);
  for (const r of dispatches) {
    const ca = new Date(r.created_at);
    const brt = new Date(ca.getTime() - 3 * 3600000).toISOString().slice(11, 19);
    console.log(`ID:${r.id} | ${brt} BRT | ${r.confrontation_label} | ${r.signal_key}`);
  }
} catch (e: any) {
  console.log('dispatch query error:', e.message);
}

// Check fixture 505633 (22:00 BRT game)
console.log('\n--- Fixture 505633 ---');
const fx = await prisma.gt_gtapi_fixtures.findFirst({ where: { id_fixture: 505633 } });
if (fx) {
  console.log('kickoff:', fx.match_kickoff.toISOString());
  console.log('score:', fx.home_score_ft, 'x', fx.away_score_ft);
}

await prisma.$disconnect();
