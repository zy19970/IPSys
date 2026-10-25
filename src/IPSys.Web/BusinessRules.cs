using System.Globalization;
using System.Text.Json.Serialization;

record ProjectInput(string? Name, string? ProjectType, string? ProjectNo, string? Leader,
    string? UndertakingOrg, string? StartDate, string? EndDate, string? ProjectStatus,
    string? Category, string? Remarks, string? Tags);

// ProjectId is a request alias only: the real owner is folders.parent_id. Callers
// routinely echo back a contract object returned by GET /api/v2/ui/contracts, so
// the alias is accepted on write and cleared before the attributes JSON is stored.
// JsonIgnore(WhenWritingNull) keeps attributes_json byte-identical to before this
// field existed - the property is read from requests but never serialized.
record ContractInput(string? Name, string? ContractNo, string? SignDate, string? Amount,
    string? SigningParties, string? Category, string? Remarks, string? Tags,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] long? ProjectId = null);

record IpInput(
    string? Name, string? IpType, string? Status,
    string? Applicants, string? RightHolders, string? Creators,
    string? Number, string? ApplicationDate,
    string? PublicationNo, string? PublicationDate,
    string? GrantNoticeNo, string? GrantNoticeDate, string? PublicationInfo,
    string? GrantDate,
    string? FirstPublishedDate, string? RegistrationDate,
    string? Category, string? Remarks, string? Tags);

record ArchiveInput(string? Name, string? Category, string? Remarks, string? Tags, string? Year = null,long? FolderId = null);

record ArchiveTransfer(string TargetWorkspace,string TargetSection,bool Move);
record ArchiveFolderInput(string Name,long? ParentId);
record ArchiveEntryOrderItem(string Kind,long Id);
record ArchiveEntryReorder(long ParentId,List<ArchiveEntryOrderItem>? Items);

record FolderMutationInput(
    ProjectInput? Project = null,
    ContractInput? Contract = null,
    IpInput? Ip = null,
    long? ParentId = null,
    ArchiveInput? Archive = null,
    ArchiveFolderInput? ArchiveFolder = null,
    string? Section = null,
    TitleInput? General = null,
    // 与 parentId 等价的顶层别名，合同专用；解析与冲突判定见 ContractOwner。
    long? ProjectId = null);

// Pure V2 business rules: no obsolete SQL writes or schema upgrades.
static class ProjectRules
{
    private static readonly string[] Types = ["科研项目", "横向项目", "其他项目"];
    private static readonly string[] Statuses = ["筹备中", "进行中", "已完成", "已终止"];
    private static string Text(string? s) => s?.Trim() ?? "";
    public static string? Check(ProjectInput x)
    {
        if (Text(x.Name).Length is 0 or > 300) return "项目名称必须填写，最多 300 字。";
        if (!Types.Contains(Text(x.ProjectType))) return "请选择科研项目、横向项目或其他项目。";
        if (Text(x.ProjectStatus).Length > 0 && !Statuses.Contains(Text(x.ProjectStatus)))
            return "项目状态无效。";
        foreach (var s in new[] {x.ProjectNo,x.Leader,x.UndertakingOrg,x.StartDate,x.EndDate,x.Category,x.Remarks,x.Tags})
            if (Text(s).Length > 4000) return "项目字段内容过长。";
        foreach (var date in new[] {Text(x.StartDate),Text(x.EndDate)})
            if (date.Length != 0 && (!DateOnly.TryParseExact(date, "yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.None, out var parsed) ||
                parsed.ToString("yyyy-MM-dd") != date)) return "日期格式必须是 yyyy-MM-dd。";
        return null;
    }
}

static class ContractRules
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
}

static class IpRules
{
    private static readonly Dictionary<string, string[]> AllowedStatuses = new()
    {
        ["发明专利"] = ["准备中", "已申请", "已公开", "实质审查中", "已授权", "已失效"],
        ["实用新型专利"] = ["准备中", "已申请", "已授权", "已失效"],
        ["外观设计专利"] = ["准备中", "已申请", "已授权", "已失效"],
        ["软件著作权"] = ["准备中", "登记中", "已登记"],
        ["其他著作权"] = ["准备中", "登记中", "已登记"],
        ["商标"] = ["准备中", "申请中", "已注册", "已失效"],
        ["集成电路布图设计"] = ["准备中", "登记中", "已登记"],
        ["国家标准"] = ["准备中", "制定中", "已发布", "已废止"],
        ["行业标准"] = ["准备中", "制定中", "已发布", "已废止"],
        ["企业标准"] = ["准备中", "制定中", "已发布", "已废止"]
    };

    private static string Clean(string? value) => value?.Trim() ?? "";
    public static IpInput Normalize(IpInput x) => x with
    {
        Name = Clean(x.Name), IpType = Clean(x.IpType), Status = Clean(x.Status)
    };
    public static string? Validate(IpInput x)
    {
        if (Clean(x.Name).Length is 0 or > 300) return "知识产权名称必填，最多 300 字。";
        if (!AllowedStatuses.TryGetValue(Clean(x.IpType), out var legal))
            return "必须选择已确认的十种知识产权类型。";
        if (Clean(x.Status).Length != 0 && !legal.Contains(Clean(x.Status)))
            return "所选状态不适用于该知识产权类型。"+ "该类型可用状态："+string.Join("、",legal)+"。";
        foreach (var field in new [] {x.Applicants,x.RightHolders,x.Creators,x.Number,
            x.PublicationNo,x.GrantNoticeNo,x.PublicationInfo,
            x.Category,x.Remarks,x.Tags})
            if (field?.Length > 4000) return "字段内容超过可保存长度。";
        foreach (var date in new [] {x.ApplicationDate,x.PublicationDate,x.GrantNoticeDate,
            x.GrantDate,x.FirstPublishedDate,x.RegistrationDate})
        {
            if (string.IsNullOrWhiteSpace(date)) continue;
            if (!DateOnly.TryParseExact(date, "yyyy-MM-dd", CultureInfo.InvariantCulture,
                    DateTimeStyles.None, out var d) || d.ToString("yyyy-MM-dd") != date)
                return "日期应填写 yyyy-MM-dd。";
        }
        return null;
    }
}

static class ArchiveRules
{
    private static string Clean(string? s) => s?.Trim() ?? "";
    public static string? Validate(ArchiveInput value)
    {
        if (Clean(value.Name).Length is 0 or > 300) return "资料名称必填，最多 300 字。";
        foreach (var s in new[] {value.Category, value.Remarks, value.Tags})
            if (Clean(s).Length > 4000) return "字段内容过长。";
        // The year is optional. Empty old records stay blank rather than guessing from notes.
        if(value.Year is not null && Clean(value.Year).Length>0 &&
           (!int.TryParse(Clean(value.Year),out int year) || year<1000 || year>9999 ||
            Clean(value.Year).Length!=4))
            return "年份应为四位数字，或留空。";
        return null;
    }
    public static string? Module(string workspace, string section) => (workspace,section) switch
    {
        ("company","certificate") => "company_certificate",
        ("personal","certificate") => "personal_certificate",
        ("company","achievement") => "research_output",
        ("company","party") => "company_party",
        ("personal","achievement") => "research_output",
        ("personal","academic") => "research_output",
        _ => null
    };
}

static class GeneralRules
{
    public static string? Validate(TitleInput input)
    {
        if (string.IsNullOrWhiteSpace(input.Title)) return "名称不能为空。";
        if (input.Title.Length > 300) return "名称不能超过 300 字。";
        return null;
    }
}
