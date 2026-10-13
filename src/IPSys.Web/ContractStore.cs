using System.Globalization;
using Microsoft.Data.Sqlite;

record ContractInput(string? Name, string? ContractNo, string? SignDate, string? Amount,
    string? SigningParties, string? Category, string? Remarks, string? Tags);
record ContractView(long Id, long ProjectId, string Workspace, string ProjectName,
    string Name, string ContractNo, string SignDate, string Amount, string SigningParties,
    string Category, string Remarks, string Tags);

static class ContractStore
{
    private static string Clean(string? value) => value?.Trim() ?? "";
    public static string? Validate(ContractInput x)
    {
        if (Clean(x.Name).Length is 0 or > 300) return "合同名称必填，最多 300 字。";
        foreach (var value in new[] { x.ContractNo, x.SigningParties, x.Category, x.Remarks, x.Tags })
            if (Clean(value).Length > 4000) return "合同字段内容过长。";
        string date = Clean(x.SignDate);
        if (date.Length != 0 &&
            (!DateOnly.TryParseExact(date, "yyyy-MM-dd", CultureInfo.InvariantCulture,
                DateTimeStyles.None, out var parsed) || parsed.ToString("yyyy-MM-dd") != date))
            return "合同签订日期必须为 yyyy-MM-dd。";
        string amount = Clean(x.Amount);
        if (amount.Length > 30 || (amount.Length != 0 &&
            (!decimal.TryParse(amount, NumberStyles.AllowLeadingSign | NumberStyles.AllowDecimalPoint,
                CultureInfo.InvariantCulture, out var parsedAmount) || parsedAmount < 0)))
            return "合同金额必须是非负的有效十进制数值。";
        return null;
    }
    public static void Ensure(SqliteConnection db)
    {
        using var cmd = db.CreateCommand();
        cmd.CommandText = """
            CREATE TABLE IF NOT EXISTS business_contracts (
              id INTEGER PRIMARY KEY,
              project_id INTEGER NOT NULL REFERENCES business_projects(id),
              workspace TEXT NOT NULL CHECK(workspace IN ('company','personal')),
              name TEXT NOT NULL,
              contract_no TEXT NOT NULL DEFAULT '',
              sign_date TEXT NOT NULL DEFAULT '',
              amount TEXT NOT NULL DEFAULT '',
              signing_parties TEXT NOT NULL DEFAULT '',
              category TEXT NOT NULL DEFAULT '',
              remarks TEXT NOT NULL DEFAULT '',
              tags TEXT NOT NULL DEFAULT '',
              deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN (0,1)));
            CREATE INDEX IF NOT EXISTS idx_contract_project
              ON business_contracts(project_id,deleted);
            CREATE INDEX IF NOT EXISTS idx_contract_workspace
              ON business_contracts(workspace,deleted);
            """;
        cmd.ExecuteNonQuery();
    }
    public static bool ActiveProject(SqliteConnection db, string workspace, long projectId)
    {
        using var cmd = db.CreateCommand();
        cmd.CommandText = """
            SELECT count(*) FROM business_projects
            WHERE id=$project AND workspace=$workspace AND deleted=0;
            """;
        cmd.Parameters.AddWithValue("$project", projectId);
        cmd.Parameters.AddWithValue("$workspace", workspace);
        return (long)cmd.ExecuteScalar()! == 1;
    }
    public static List<ContractView> List(SqliteConnection db, string workspace)
    {
        var contracts = new List<ContractView>();
        using var cmd = db.CreateCommand();
        cmd.CommandText = """
            SELECT c.id,c.project_id,c.workspace,p.name,c.name,c.contract_no,c.sign_date,
                   c.amount,c.signing_parties,c.category,c.remarks,c.tags
            FROM business_contracts c INNER JOIN business_projects p
              ON p.id=c.project_id AND p.workspace=c.workspace
            WHERE c.workspace=$workspace AND c.deleted=0 AND p.deleted=0
            ORDER BY c.id DESC;
            """;
        cmd.Parameters.AddWithValue("$workspace", workspace);
        using var reader = cmd.ExecuteReader();
        while (reader.Read())
        {
            contracts.Add(new ContractView(reader.GetInt64(0), reader.GetInt64(1),
                reader.GetString(2), reader.GetString(3), reader.GetString(4),
                reader.GetString(5), reader.GetString(6), reader.GetString(7),
                reader.GetString(8), reader.GetString(9), reader.GetString(10),
                reader.GetString(11)));
        }
        return contracts;
    }
    private static void AddFields(SqliteCommand cmd, ContractInput x)
    {
        cmd.Parameters.AddWithValue("$name", Clean(x.Name));
        cmd.Parameters.AddWithValue("$no", Clean(x.ContractNo));
        cmd.Parameters.AddWithValue("$date", Clean(x.SignDate));
        cmd.Parameters.AddWithValue("$amount", Clean(x.Amount));
        cmd.Parameters.AddWithValue("$parties", Clean(x.SigningParties));
        cmd.Parameters.AddWithValue("$category", Clean(x.Category));
        cmd.Parameters.AddWithValue("$remarks", Clean(x.Remarks));
        cmd.Parameters.AddWithValue("$tags", Clean(x.Tags));
    }
    public static long Add(SqliteConnection db, string workspace, long projectId, ContractInput input)
    {
        using var cmd = db.CreateCommand();
        cmd.CommandText = """
            INSERT INTO business_contracts(project_id,workspace,name,contract_no,sign_date,
                                           amount,signing_parties,category,remarks,tags)
            VALUES($project,$workspace,$name,$no,$date,$amount,$parties,$category,$remarks,$tags);
            SELECT last_insert_rowid();
            """;
        cmd.Parameters.AddWithValue("$project", projectId);
        cmd.Parameters.AddWithValue("$workspace", workspace);
        AddFields(cmd, input);
        return (long)cmd.ExecuteScalar()!;
    }
    public static bool Update(SqliteConnection db, string workspace, long id, ContractInput input)
    {
        using var cmd = db.CreateCommand();
        cmd.CommandText = """
            UPDATE business_contracts
            SET name=$name,contract_no=$no,sign_date=$date,amount=$amount,
                signing_parties=$parties,category=$category,remarks=$remarks,tags=$tags
            WHERE id=$id AND workspace=$workspace AND deleted=0
              AND EXISTS (SELECT 1 FROM business_projects
                WHERE business_projects.id=business_contracts.project_id
                  AND business_projects.workspace=$workspace AND business_projects.deleted=0);
            """;
        cmd.Parameters.AddWithValue("$id", id);
        cmd.Parameters.AddWithValue("$workspace", workspace);
        AddFields(cmd, input);
        return cmd.ExecuteNonQuery() == 1;
    }
    public static bool SoftDelete(SqliteConnection db, string workspace, long id)
    {
        using var cmd = db.CreateCommand();
        cmd.CommandText = """
            UPDATE business_contracts SET deleted=1
            WHERE id=$id AND workspace=$workspace AND deleted=0
              AND EXISTS (SELECT 1 FROM business_projects
                WHERE business_projects.id=business_contracts.project_id
                  AND business_projects.workspace=$workspace AND business_projects.deleted=0);
            """;
        cmd.Parameters.AddWithValue("$id", id);
        cmd.Parameters.AddWithValue("$workspace", workspace);
        return cmd.ExecuteNonQuery() == 1;
    }
    // In the SAME transaction as creation of the destination project.
    // The copied child never points back to the source workspace or source project.
    public static void CopyChildren(SqliteConnection db, SqliteTransaction transaction,
        string sourceWorkspace, long sourceId, string targetWorkspace, long targetId)
    {
        using var cmd = db.CreateCommand();
        cmd.Transaction = transaction;
        cmd.CommandText = """
            INSERT INTO business_contracts(project_id,workspace,name,contract_no,sign_date,
                amount,signing_parties,category,remarks,tags)
            SELECT $targetId,$targetWorkspace,name,contract_no,sign_date,
                amount,signing_parties,category,remarks,tags
            FROM business_contracts
            WHERE project_id=$sourceId AND workspace=$sourceWorkspace AND deleted=0;
            """;
        cmd.Parameters.AddWithValue("$targetId", targetId);
        cmd.Parameters.AddWithValue("$targetWorkspace", targetWorkspace);
        cmd.Parameters.AddWithValue("$sourceId", sourceId);
        cmd.Parameters.AddWithValue("$sourceWorkspace", sourceWorkspace);
        cmd.ExecuteNonQuery();
    }
}
