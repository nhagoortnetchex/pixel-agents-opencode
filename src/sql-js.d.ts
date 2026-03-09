declare module 'sql.js/dist/sql-asm.js' {
  interface QueryExecResult {
    columns: string[];
    values: (number | string | Uint8Array | null)[][];
  }

  interface Database {
    exec(sql: string, params?: (number | string | Uint8Array | null)[]): QueryExecResult[];
    close(): void;
  }

  interface DatabaseConstructor {
    new (data?: ArrayLike<number> | Buffer | null): Database;
  }

  interface SqlJsStatic {
    Database: DatabaseConstructor;
  }

  function initSqlJs(): Promise<SqlJsStatic>;

  export default initSqlJs;
}
