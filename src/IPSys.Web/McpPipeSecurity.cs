using System.IO.Pipes;
using System.Security.AccessControl;
using System.Security.Principal;

// Windows named pipe ACLs use TokenUser, not TokenOwner (which can become
// BUILTIN\\Administrators after UAC elevation). Fail closed on any ACL error.
static class McpPipeSecurity
{
    private static SecurityIdentifier CurrentUserSid =>
        WindowsIdentity.GetCurrent().User ??
        throw new UnauthorizedAccessException("无法确定当前 Windows 用户身份。");

    internal static NamedPipeServerStream CreateServer(string name,int capacity)
    {
        var sid=CurrentUserSid;
        var acl=new PipeSecurity();
        acl.SetOwner(sid);
        acl.SetAccessRuleProtection(true,false);
        acl.AddAccessRule(new PipeAccessRule(sid,PipeAccessRights.FullControl,
            AccessControlType.Allow));
        acl.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(
            WellKnownSidType.LocalSystemSid,null),PipeAccessRights.FullControl,
            AccessControlType.Allow));
        // CurrentUserOnly silently discards a supplied PipeSecurity, so do
        // not specify it here. The explicit user-only DACL is the boundary.
        return NamedPipeServerStreamAcl.Create(name,PipeDirection.InOut,capacity,
            PipeTransmissionMode.Byte,PipeOptions.Asynchronous,0,0,acl);
    }

    internal static NamedPipeClientStream CreateClient(string name)=>
        new(".",name,PipeDirection.InOut,PipeOptions.Asynchronous);

    internal static void VerifyServerOwner(NamedPipeClientStream client)
    {
        // Unlike PipeOptions.CurrentUserOnly, this compares the pipe's owner
        // with TokenUser, not the caller's elevation-dependent TokenOwner.
        var owner=(SecurityIdentifier)PipesAclExtensions.GetAccessControl(client)
            .GetOwner(typeof(SecurityIdentifier));
        if(!owner.Equals(CurrentUserSid))
            throw new UnauthorizedAccessException(
                "MCP 管道所属用户与当前 Windows 用户不一致，已拒绝连接。");
    }
}
