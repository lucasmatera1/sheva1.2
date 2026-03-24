import odbc from "odbc";
import { env, isOdbcConfigured } from "./env";

type SourceHealth = {
  configured: boolean;
  connected: boolean;
  provider: "mysql-odbc";
  mode: "external-source" | "unconfigured";
  schema: string | null;
};

type SourceTableColumn = {
  columnName: string;
  dataType: string;
  isNullable: boolean;
  columnKey: string | null;
};

type SourceTable = {
  tableName: string;
  tableType: string;
  columns: SourceTableColumn[];
};

const asRows = <TRow>(result: unknown) => result as TRow[];

const getConnectionString = () => env.MYSQL_ODBC_CONNECTION_STRING ?? "";

const withConnection = async <T>(handler: (connection: odbc.Connection) => Promise<T>) => {
  const connection = await odbc.connect(getConnectionString());

  try {
    return await handler(connection);
  } finally {
    await connection.close();
  }
};

const resolveSchemaName = async (connection: odbc.Connection) => {
  if (env.MYSQL_ODBC_SCHEMA) {
    return env.MYSQL_ODBC_SCHEMA;
  }

  const rows = asRows<{ schemaName: string | null }>(
    await connection.query("SELECT DATABASE() AS schemaName"),
  );

  return rows[0]?.schemaName ?? null;
};

export async function getOdbcSourceHealth(): Promise<SourceHealth> {
  if (!isOdbcConfigured) {
    return {
      configured: false,
      connected: false,
      provider: "mysql-odbc",
      mode: "unconfigured",
      schema: null,
    };
  }

  try {
    return await withConnection(async (connection) => {
      await connection.query("SELECT 1 AS alive");
      const schema = await resolveSchemaName(connection);

      return {
        configured: true,
        connected: true,
        provider: "mysql-odbc",
        mode: "external-source",
        schema,
      };
    });
  } catch {
    return {
      configured: true,
      connected: false,
      provider: "mysql-odbc",
      mode: "external-source",
      schema: env.MYSQL_ODBC_SCHEMA ?? null,
    };
  }
}

export async function inspectOdbcSourceSchema() {
  if (!isOdbcConfigured) {
    return {
      schema: null,
      tables: [] as SourceTable[],
    };
  }

  return withConnection(async (connection) => {
    const schema = await resolveSchemaName(connection);

    if (!schema) {
      return {
        schema: null,
        tables: [] as SourceTable[],
      };
    }

    const tables = asRows<{ tableName: string; tableType: string }>(
      await connection.query(
        `
          SELECT
            TABLE_NAME AS tableName,
            TABLE_TYPE AS tableType
          FROM INFORMATION_SCHEMA.TABLES
          WHERE TABLE_SCHEMA = ?
          ORDER BY TABLE_NAME
        `,
        [schema],
      ),
    );

    const columns = asRows<{
      tableName: string;
      columnName: string;
      dataType: string;
      isNullable: "YES" | "NO";
      columnKey: string | null;
    }>(
      await connection.query(
        `
          SELECT
            TABLE_NAME AS tableName,
            COLUMN_NAME AS columnName,
            DATA_TYPE AS dataType,
            IS_NULLABLE AS isNullable,
            COLUMN_KEY AS columnKey
          FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_SCHEMA = ?
          ORDER BY TABLE_NAME, ORDINAL_POSITION
        `,
        [schema],
      ),
    );

    const normalizedTables: SourceTable[] = tables.map((table) => ({
      tableName: table.tableName,
      tableType: table.tableType,
      columns: columns
        .filter((column) => column.tableName === table.tableName)
        .map((column) => ({
          columnName: column.columnName,
          dataType: column.dataType,
          isNullable: column.isNullable === "YES",
          columnKey: column.columnKey,
        })),
    }));

    return {
      schema,
      tables: normalizedTables,
    };
  });
}