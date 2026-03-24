import { config } from "dotenv";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../../..");

config({ path: join(repoRoot, ".env") });

const prisma = new PrismaClient();
const outputDir = join(repoRoot, "db-export");
const dataDir = join(outputDir, "data");
const sampleLimit = 200;

type TableRow = Record<string, unknown>;

function escapeCsvValue(value: unknown) {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  const escaped = text.replace(/"/g, '""');

  return /[",\n\r]/.test(escaped) ? `"${escaped}"` : escaped;
}

function toCsv(rows: TableRow[], headers: string[]) {
  const lines = [headers.join(",")];

  for (const row of rows) {
    lines.push(headers.map((header) => escapeCsvValue(row[header])).join(","));
  }

  return `${lines.join("\n")}\n`;
}

async function main() {
  await mkdir(dataDir, { recursive: true });

  const tables = (await prisma.$queryRawUnsafe<Array<Record<string, string>>>("SHOW TABLES"))
    .map((row) => Object.values(row)[0])
    .sort((left, right) => left.localeCompare(right));

  const schemaRows: TableRow[] = [];
  const inventoryRows: TableRow[] = [];

  for (const tableName of tables) {
    const columns = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(`SHOW COLUMNS FROM \`${tableName}\``);

    for (const column of columns) {
      schemaRows.push({
        table: tableName,
        field: column.Field,
        type: column.Type,
        nullable: column.Null,
        key: column.Key,
        default: column.Default,
        extra: column.Extra,
      });
    }

    const countResult = await prisma.$queryRawUnsafe<Array<{ total: bigint | number }>>(
      `SELECT COUNT(*) AS total FROM \`${tableName}\``,
    );
    const totalRows = Number(countResult[0]?.total ?? 0);

    inventoryRows.push({
      table: tableName,
      total_rows: totalRows,
      exported_rows: Math.min(totalRows, sampleLimit),
    });

    if (totalRows === 0) {
      await writeFile(join(dataDir, `${tableName}.csv`), `${columns.map((column) => String(column.Field)).join(",")}\n`, "utf8");
      continue;
    }

    const sampleRows = await prisma.$queryRawUnsafe<Array<TableRow>>(
      `SELECT * FROM \`${tableName}\` LIMIT ${sampleLimit}`,
    );
    const headers = Array.from(
      new Set(sampleRows.flatMap((row) => Object.keys(row)).concat(columns.map((column) => String(column.Field)))),
    );

    await writeFile(join(dataDir, `${tableName}.csv`), toCsv(sampleRows, headers), "utf8");
  }

  await writeFile(
    join(outputDir, "schema.csv"),
    toCsv(schemaRows, ["table", "field", "type", "nullable", "key", "default", "extra"]),
    "utf8",
  );

  await writeFile(
    join(outputDir, "inventory.csv"),
    toCsv(inventoryRows, ["table", "total_rows", "exported_rows"]),
    "utf8",
  );

  console.log(`Export concluido em ${outputDir}`);
  console.log(`Tabelas exportadas: ${tables.length}`);
  console.log(`Amostra por tabela: ${sampleLimit} linhas`);
}

main()
  .catch((error) => {
    console.error("Falha ao exportar banco:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });