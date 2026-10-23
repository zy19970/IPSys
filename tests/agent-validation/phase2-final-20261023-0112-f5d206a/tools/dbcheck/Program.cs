// J-12 只读证据工具：以 SQLCipher 打开测试库，输出 integrity / 外键 / 孤儿引用清单。
// 只读模式（Mode=ReadOnly），不写入任何数据；仅作为本地测试工具，不参与产品构建。
using System.Text.Json;
using Microsoft.Data.Sqlite;

if (args.Length < 2)
{
    Console.Error.WriteLine("用法: dbcheck <db路径> <密码>");
    return 2;
}

var path = args[0];
var pwd = args[1];
var outObj = new Dictionary<string, object>();

try
{
    var builder = new SqliteConnectionStringBuilder
    {
        DataSource = path,
        Mode = SqliteOpenMode.ReadOnly,
        Password = pwd,
        Pooling = false
    };
    using var db = new SqliteConnection(builder.ToString());
    db.Open();

    long Scalar(string sql)
    {
        using var c = db.CreateCommand();
        c.CommandText = sql;
        return Convert.ToInt64(c.ExecuteScalar() ?? 0L);
    }
    string Text(string sql)
    {
        using var c = db.CreateCommand();
        c.CommandText = sql;
        return Convert.ToString(c.ExecuteScalar() ?? "") ?? "";
    }

    outObj["cipherVersion"] = Text("PRAGMA cipher_version;");

    // 1) 完整性
    outObj["integrity"] = Text("PRAGMA integrity_check;");

    // 2) 外键：返回行数应与违规数相等；这里把违规明细也取出来
    var fk = new List<string>();
    using (var c = db.CreateCommand())
    {
        c.CommandText = "PRAGMA foreign_key_check;";
        using var r = c.ExecuteReader();
        while (r.Read())
        {
            var tbl = r.IsDBNull(0) ? "" : r.GetString(0);
            var rowid = r.IsDBNull(1) ? "" : r.GetValue(1).ToString();
            var parent = r.IsDBNull(2) ? "" : r.GetString(2);
            fk.Add($"{tbl}#{rowid} -> {parent}");
            if (fk.Count >= 50) break;
        }
    }
    outObj["foreignKeyViolations"] = fk;

    // 3) 孤儿引用：version 指向不存在的 file / object（FK 应已阻止，作交叉验证）
    outObj["versionsMissingFile"] = Scalar(
        "SELECT count(*) FROM file_versions v WHERE NOT EXISTS(SELECT 1 FROM files f WHERE f.id=v.file_id AND f.workspace=v.workspace);");
    outObj["versionsMissingObject"] = Scalar(
        "SELECT count(*) FROM file_versions v WHERE NOT EXISTS(SELECT 1 FROM file_objects o WHERE o.id=v.object_id AND o.workspace=v.workspace);");

    // 4) 未被任何版本引用的 ready 物理对象（真正的孤儿原件）
    outObj["readyObjectsUnreferenced"] = Scalar(
        "SELECT count(*) FROM file_objects o WHERE o.state='ready' AND NOT EXISTS(SELECT 1 FROM file_versions v WHERE v.object_id=o.id AND v.workspace=o.workspace);");

    // 5) ready 且有尺寸但没有 chunk 的对象（内容缺失）
    outObj["readyObjectsWithoutChunks"] = Scalar(
        "SELECT count(*) FROM file_objects o WHERE o.state='ready' AND o.size>0 AND NOT EXISTS(SELECT 1 FROM file_chunks c WHERE c.object_id=o.id AND c.workspace=o.workspace);");

    // 6) 半成品对象
    outObj["writingObjects"] = Scalar("SELECT count(*) FROM file_objects WHERE state='writing';");

    // 6b) 半成品对象明细（定位是哪一次中断留下的，便于判定是否属于产品缺陷）
    {
        var wr = new List<string>();
        using var c = db.CreateCommand();
        c.CommandText = "SELECT id,workspace,expected_size,coalesce(size,-1) FROM file_objects WHERE state='writing' ORDER BY id;";
        using var r = c.ExecuteReader();
        while (r.Read())
        {
            wr.Add($"#{r.GetValue(0)} {r.GetValue(1)} expected={r.GetValue(2)} written={r.GetValue(3)}");
            if (wr.Count >= 20) break;
        }
        outObj["writingRows"] = wr;
    }

    // 7) chunk 指向不存在的对象
    outObj["orphanChunks"] = Scalar(
        "SELECT count(*) FROM file_chunks c WHERE NOT EXISTS(SELECT 1 FROM file_objects o WHERE o.id=c.object_id AND o.workspace=c.workspace);");

    // 8) 链接指向不存在的 folder / file
    outObj["linksMissingFolder"] = Scalar(
        "SELECT count(*) FROM folder_file_links l WHERE NOT EXISTS(SELECT 1 FROM folders f WHERE f.id=l.folder_id AND f.workspace=l.workspace);");
    outObj["linksMissingFile"] = Scalar(
        "SELECT count(*) FROM folder_file_links l WHERE NOT EXISTS(SELECT 1 FROM files f WHERE f.id=l.file_id AND f.workspace=l.workspace);");

    // 9) 规模快照（用于报告引用计数）
    outObj["counts"] = new Dictionary<string, long>
    {
        ["folders"] = Scalar("SELECT count(*) FROM folders;"),
        ["foldersDeleted"] = Scalar("SELECT count(*) FROM folders WHERE deleted=1;"),
        ["files"] = Scalar("SELECT count(*) FROM files;"),
        ["filesDeleted"] = Scalar("SELECT count(*) FROM files WHERE deleted=1;"),
        ["file_objects"] = Scalar("SELECT count(*) FROM file_objects;"),
        ["file_versions"] = Scalar("SELECT count(*) FROM file_versions;"),
        ["file_chunks"] = Scalar("SELECT count(*) FROM file_chunks;"),
        ["folder_file_links"] = Scalar("SELECT count(*) FROM folder_file_links;"),
        ["linksDeleted"] = Scalar("SELECT count(*) FROM folder_file_links WHERE deleted=1;"),
    };

    // 10) 共享内容对象（多个 version 指向同一 objectId）—— J-05 关注点
    outObj["sharedObjects"] = Scalar(
        "SELECT count(*) FROM (SELECT object_id,workspace FROM file_versions GROUP BY object_id,workspace HAVING count(*)>1);");

    Console.WriteLine(JsonSerializer.Serialize(outObj, new JsonSerializerOptions { WriteIndented = true }));
    return 0;
}
catch (Exception ex)
{
    Console.Error.WriteLine("DBCHECK_ERROR: " + ex.GetType().Name + ": " + ex.Message);
    return 1;
}
