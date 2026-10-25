using System.Globalization;
using System.IO.Compression;
using System.Text;
using System.Text.Json;
using System.Xml;
using System.Xml.Linq;
using Microsoft.Data.Sqlite;

// Fixed, offline XLSX ledgers (M0). No macros, formulas or arbitrary field mapping.
static partial class ExcelLedger
{
    internal const string ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    internal const int MaxWorkbookBytes=8*1024*1024;
    private static readonly JsonSerializerOptions Json=new(JsonSerializerDefaults.Web);
    private sealed record Column(string Property,string Heading);
    private static readonly Column[] Projects=
    [
        new("name","项目名称"),new("projectType","项目类别"),new("projectNo","项目编号"),
        new("leader","负责人"),new("undertakingOrg","承担单位"),new("startDate","开始日期"),
        new("endDate","结束日期"),new("projectStatus","项目状态"),new("category","辅助分类"),
        new("remarks","备注"),new("tags","标签")
    ];
    private static readonly Column[] IntellectualProperty=
    [
        new("name","知识产权名称"),new("ipType","知识产权类型"),new("status","状态"),
        new("applicants","申请人"),new("rightHolders","当前权利人"),new("creators","发明人／作者"),
        new("number","编号"),new("applicationDate","申请日"),new("publicationNo","公开号"),
        new("publicationDate","公开日"),new("grantNoticeNo","授权公告号"),
        new("grantNoticeDate","授权公告日"),new("publicationInfo","公开／授权公告信息"),
        new("grantDate","授权日"),
        new("firstPublishedDate","首次发表日期"),new("registrationDate","登记／注册日期"),
        new("category","辅助分类"),new("remarks","备注"),new("tags","标签")
    ];
    private static readonly Column[] ArchiveColumns=
    [
        new("name","资料名称"),new("category","类别"),
        new("remarks","备注"),new("tags","标签")
    ];
    private static readonly Column[] GeneralColumns=[new("title","资料名称")];
    internal static bool ValidKind(string kind)=>kind is "project" or "ip" or "archive" or "general";
    internal static bool SupportsImport(string kind)=>kind is "project" or "ip" or "archive" or "general";
    internal static bool ValidScope(string workspace,string kind,string? section)=>
        ValidKind(kind)&&(kind!="archive"||ArchiveRules.Module(workspace,section??"")!=null);

    private static Column[] Columns(string kind)=>kind switch
    {
        "project"=>Projects,"ip"=>IntellectualProperty,"archive"=>ArchiveColumns,
        "general"=>GeneralColumns,
        _=>throw new InvalidDataException("无效的 Excel 台账模块。")
    };
    private static string Text(JsonElement json,string key)
    {
        if(!json.TryGetProperty(key,out var value)||value.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined)
            return "";
        return value.ValueKind==JsonValueKind.String?value.GetString()??"":value.ToString();
    }
    private static JsonElement JsonOf(object item)=>JsonSerializer.SerializeToElement(item,Json);
    internal static byte[] Template(string kind)
    {
        if(!SupportsImport(kind))throw new InvalidDataException("此模块仅支持 Excel 导出。");
        return Build(Columns(kind),[]);
    }
    private static readonly XNamespace Main="http://schemas.openxmlformats.org/spreadsheetml/2006/main";
    private static readonly XNamespace Rel="http://schemas.openxmlformats.org/officeDocument/2006/relationships";
    private static readonly XNamespace PackageRel="http://schemas.openxmlformats.org/package/2006/relationships";
    private static string Letter(int i)
    {
        string s="";
        for(++i;i>0;i=(i-1)/26)s=(char)('A'+(i-1)%26)+s;
        return s;
    }
    private static void Entry(ZipArchive zip,string name,XDocument doc)
    {
        var e=zip.CreateEntry(name,CompressionLevel.Fastest);
        using var output=e.Open();
        using var writer=XmlWriter.Create(output,new XmlWriterSettings{Encoding=new UTF8Encoding(false)});
        doc.Save(writer);
    }
    private static XElement Cell(int col,int row,string value,bool header)
    {
        // inlineStr + text style preserves identifiers, leading zeros and date strings;
        // user-entered '=...' is always text, never an executable formula.
        return new XElement(Main+"c",
            new XAttribute("r",Letter(col)+row),new XAttribute("t","inlineStr"),
            new XAttribute("s",header?1:2),
            new XElement(Main+"is",new XElement(Main+"t",
                new XAttribute(XNamespace.Xml+"space","preserve"),value)));
    }
    private static byte[] Build(Column[] columns,IReadOnlyList<string[]> data)
    {
        using var stream=new MemoryStream();
        using(var zip=new ZipArchive(stream,ZipArchiveMode.Create,true))
        {
            XNamespace c="http://schemas.openxmlformats.org/package/2006/content-types";
            Entry(zip,"[Content_Types].xml",new XDocument(new XElement(c+"Types",
                new XElement(c+"Default",new XAttribute("Extension","rels"),
                    new XAttribute("ContentType","application/vnd.openxmlformats-package.relationships+xml")),
                new XElement(c+"Default",new XAttribute("Extension","xml"),
                    new XAttribute("ContentType","application/xml")),
                new XElement(c+"Override",new XAttribute("PartName","/xl/workbook.xml"),
                    new XAttribute("ContentType","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml")),
                new XElement(c+"Override",new XAttribute("PartName","/xl/worksheets/sheet1.xml"),
                    new XAttribute("ContentType","application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml")),
                new XElement(c+"Override",new XAttribute("PartName","/xl/styles.xml"),
                    new XAttribute("ContentType","application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml")))));
            Entry(zip,"_rels/.rels",new XDocument(new XElement(PackageRel+"Relationships",
                new XElement(PackageRel+"Relationship",new XAttribute("Id","rId1"),
                    new XAttribute("Type",Rel.NamespaceName+"/officeDocument"),new XAttribute("Target","xl/workbook.xml")))));
            Entry(zip,"xl/workbook.xml",new XDocument(new XElement(Main+"workbook",
                new XAttribute(XNamespace.Xmlns+"r",Rel),
                new XElement(Main+"sheets",
                    new XElement(Main+"sheet",new XAttribute("name","台账"),
                        new XAttribute("sheetId","1"),new XAttribute(Rel+"id","rId1"))))));
            Entry(zip,"xl/_rels/workbook.xml.rels",new XDocument(new XElement(PackageRel+"Relationships",
                new XElement(PackageRel+"Relationship",new XAttribute("Id","rId1"),
                    new XAttribute("Type",Rel.NamespaceName+"/worksheet"),new XAttribute("Target","worksheets/sheet1.xml")),
                new XElement(PackageRel+"Relationship",new XAttribute("Id","rId2"),
                    new XAttribute("Type",Rel.NamespaceName+"/styles"),new XAttribute("Target","styles.xml")))));
            Entry(zip,"xl/styles.xml",new XDocument(new XElement(Main+"styleSheet",
                new XElement(Main+"fonts",new XAttribute("count","2"),
                    new XElement(Main+"font",new XElement(Main+"sz",new XAttribute("val","11"))),
                    new XElement(Main+"font",new XElement(Main+"b"),new XElement(Main+"sz",new XAttribute("val","11")))),
                new XElement(Main+"fills",new XAttribute("count","3"),
                    new XElement(Main+"fill",new XElement(Main+"patternFill",new XAttribute("patternType","none"))),
                    new XElement(Main+"fill",new XElement(Main+"patternFill",new XAttribute("patternType","gray125"))),
                    new XElement(Main+"fill",new XElement(Main+"patternFill",new XAttribute("patternType","solid"),
                        new XElement(Main+"fgColor",new XAttribute("rgb","FFE6F1F3")),
                        new XElement(Main+"bgColor",new XAttribute("indexed","64"))))),
                new XElement(Main+"borders",new XAttribute("count","1"),new XElement(Main+"border")),
                new XElement(Main+"cellStyleXfs",new XAttribute("count","1"),
                    new XElement(Main+"xf",new XAttribute("numFmtId","0"),new XAttribute("fontId","0"),
                        new XAttribute("fillId","0"),new XAttribute("borderId","0"))),
                new XElement(Main+"cellXfs",new XAttribute("count","3"),
                    new XElement(Main+"xf",new XAttribute("numFmtId","0"),new XAttribute("fontId","0"),
                        new XAttribute("fillId","0"),new XAttribute("borderId","0"),new XAttribute("xfId","0")),
                    new XElement(Main+"xf",new XAttribute("numFmtId","49"),new XAttribute("fontId","1"),
                        new XAttribute("fillId","2"),new XAttribute("borderId","0"),new XAttribute("xfId","0"),
                        new XAttribute("applyNumberFormat","1")),
                    new XElement(Main+"xf",new XAttribute("numFmtId","49"),new XAttribute("fontId","0"),
                        new XAttribute("fillId","0"),new XAttribute("borderId","0"),new XAttribute("xfId","0"),
                        new XAttribute("applyNumberFormat","1"))))));
            var rows=new List<XElement>{new(Main+"row",new XAttribute("r","1"),
                columns.Select((col,i)=>Cell(i,1,col.Heading,true)))};
            for(int r=0;r<data.Count;r++)
                rows.Add(new XElement(Main+"row",new XAttribute("r",r+2),
                    data[r].Select((val,i)=>Cell(i,r+2,val,false))));
            Entry(zip,"xl/worksheets/sheet1.xml",new XDocument(new XElement(Main+"worksheet",
                new XElement(Main+"sheetViews",new XElement(Main+"sheetView",
                    new XAttribute("workbookViewId","0"),new XElement(Main+"pane",
                        new XAttribute("ySplit","1"),new XAttribute("topLeftCell","A2"),
                        new XAttribute("activePane","bottomLeft"),new XAttribute("state","frozen")))),
                new XElement(Main+"cols",Enumerable.Range(1,columns.Length)
                    .Select(i=>new XElement(Main+"col",new XAttribute("min",i),
                        new XAttribute("max",i),new XAttribute("width",i is 1 or 2?26:22),
                        new XAttribute("customWidth","1")))),
                new XElement(Main+"sheetData",rows),
                new XElement(Main+"autoFilter",new XAttribute("ref","A1:"+Letter(columns.Length-1)+(data.Count+1))))));
        }
        return stream.ToArray();
    }

    private static string Val(XElement cell,IReadOnlyList<string> shared)
    {
        if(cell.Element(Main+"f")!=null)
            throw new InvalidDataException("Excel 公式不能作为台账字段导入，请改为纯文本。");
        string t=(string?)cell.Attribute("t")??"";
        if(t=="inlineStr")return string.Concat(cell.Descendants(Main+"t").Select(x=>x.Value));
        string v=(string?)cell.Element(Main+"v")??"";
        if(t=="s")
        {
            if(!int.TryParse(v,out int i)||i<0||i>=shared.Count)
                throw new InvalidDataException("共享字符串编号无效。");
            return shared[i];
        }
        return v;
    }
    private static int ColumnIndex(string? reference)
    {
        if(string.IsNullOrEmpty(reference))return -1;
        int result=0,i=0;
        while(i<reference.Length&&reference[i] is >= 'A' and <= 'Z')
        {result=result*26+(reference[i]-'A'+1);i++;}
        return result>0?result-1:-1;
    }
    private static List<(int Number,string[] Values)> ReadSheet(byte[] bytes,Column[] fields)
    {
        if(bytes.Length is 0 or > MaxWorkbookBytes)throw new InvalidDataException("Excel 文件不能超过 8 MiB。");
        using var stream=new MemoryStream(bytes);
        using var zip=new ZipArchive(stream,ZipArchiveMode.Read);
        if(zip.Entries.Count>50||zip.Entries.Sum(e=>e.Length)>20L*1024*1024)
            throw new InvalidDataException("Excel 结构过大或存在异常压缩内容。");
        var sheet=zip.GetEntry("xl/worksheets/sheet1.xml")
            ??throw new InvalidDataException("请使用系统提供的固定 Excel 模板。");
        if(sheet.Length>12L*1024*1024)throw new InvalidDataException("Excel 工作表过大。");
        XDocument Xml(ZipArchiveEntry file)
        {
            using var sr=file.Open();
            using var xr=XmlReader.Create(sr,new XmlReaderSettings{
                DtdProcessing=DtdProcessing.Prohibit,XmlResolver=null,MaxCharactersInDocument=16*1024*1024
            });
            return XDocument.Load(xr);
        }
        var shared=new List<string>();
        if(zip.GetEntry("xl/sharedStrings.xml") is { } sharedFile)
        {
            if(sharedFile.Length>8L*1024*1024)throw new InvalidDataException("共享字符串过大。");
            shared.AddRange(Xml(sharedFile).Descendants(Main+"si")
                .Select(si=>string.Concat(si.Descendants(Main+"t").Select(t=>t.Value))));
        }
        var output=new List<(int,string[])>();
        var rows=Xml(sheet).Descendants(Main+"sheetData").Elements(Main+"row").ToList();
        if(rows.Count==0)throw new InvalidDataException("没有固定 Excel 表头。");
        if(rows.Count>5001)throw new InvalidDataException("每次最多导入 5000 条 Excel 记录。");
        foreach(var row in rows)
        {
            if(!int.TryParse((string?)row.Attribute("r"),out int line)||line<=0)
                throw new InvalidDataException("工作表行号无效。");
            var cells=new string[fields.Length];
            foreach(var cell in row.Elements(Main+"c"))
            {
                int col=ColumnIndex((string?)cell.Attribute("r"));
                if(col<0||col>=fields.Length)
                    throw new InvalidDataException($"第 {line} 行包含不属于模板的列。");
                cells[col]=Val(cell,shared);
            }
            if(line==1)
            {
                if(!cells.SequenceEqual(fields.Select(f=>f.Heading)))
                    throw new InvalidDataException("表头不匹配，请下载当前模块的固定 Excel 模板，不支持自由字段映射。");
            }
            else if(cells.Any(x=>!string.IsNullOrWhiteSpace(x)))
                output.Add((line,cells.Select(x=>x??"").ToArray()));
        }
        return output;
    }
    private static ArchiveInput Archive(string[] v)=>new(v[0],v[1],v[2],v[3]);
    private static string? ValidateGeneral(string? title)=>
        string.IsNullOrWhiteSpace(title)||title.Trim().Length>300
        ?"资料名称必填，最多 300 字。":null;
    private static long InsertGeneral(SqliteConnection db,string workspace,string title)
    {
        using var cmd=db.CreateCommand();
        cmd.CommandText="INSERT INTO records(workspace,title) VALUES($workspace,$title); SELECT last_insert_rowid();";
        cmd.Parameters.AddWithValue("$workspace",workspace);
        cmd.Parameters.AddWithValue("$title",title.Trim());
        return (long)cmd.ExecuteScalar()!;
    }
    private static bool UpdateGeneral(SqliteConnection db,string workspace,long id,string title)
    {
        using var cmd=db.CreateCommand();
        cmd.CommandText="UPDATE records SET title=$title WHERE id=$id AND workspace=$workspace AND deleted=0;";
        cmd.Parameters.AddWithValue("$title",title.Trim());
        cmd.Parameters.AddWithValue("$id",id);
        cmd.Parameters.AddWithValue("$workspace",workspace);
        return cmd.ExecuteNonQuery()==1;
    }

    private static ProjectInput Project(string[] v)=>new(
        v[0],v[1],v[2],v[3],v[4],v[5],v[6],
        string.IsNullOrWhiteSpace(v[7])?"筹备中":v[7],v[8],v[9],v[10]);
    private static IpInput Ip(string[] v)=>new(
        v[0],v[1],v[2],v[3],v[4],v[5],v[6],v[7],v[8],v[9],v[10],
        v[11],v[12],v[13],v[14],v[15],v[16],v[17],v[18]);
    private static bool Same(string a,string b)=>string.Equals(a.Trim(),b.Trim(),StringComparison.OrdinalIgnoreCase);
}
