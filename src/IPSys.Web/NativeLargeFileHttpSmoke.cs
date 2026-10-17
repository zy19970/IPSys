using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;

// Opt-in >2 GiB real SQLCipher/HTTP roundtrip. Generates bytes on demand; never
// creates a multi-GiB fixture or materializes a downloaded multi-GiB array.
static class NativeLargeFileHttpSmoke
{
    private const long TestBytes=2L*1024*1024*1024+12345;
    private static void Check(bool ok,string description)
    {
        if(!ok)throw new IOException("LARGE FILE SMOKE: "+description);
    }

    private sealed class RepeatingStream(long length,byte[] pattern):Stream
    {
        private long position;
        public override bool CanRead=>true;
        public override bool CanSeek=>false;
        public override bool CanWrite=>false;
        public override long Length=>length;
        public override long Position {get=>position;set=>throw new NotSupportedException();}
        public override int Read(byte[] buffer,int offset,int count)=>
            ReadCore(buffer.AsSpan(offset,count));
        public override ValueTask<int> ReadAsync(Memory<byte> buffer,
            CancellationToken cancellationToken=default)
        {
            cancellationToken.ThrowIfCancellationRequested();
            return ValueTask.FromResult(ReadCore(buffer.Span));
        }
        public override Task<int> ReadAsync(byte[] buffer,int offset,int count,
            CancellationToken cancellationToken)=>
            ReadAsync(buffer.AsMemory(offset,count),cancellationToken).AsTask();
        private int ReadCore(Span<byte> target)
        {
            int requested=(int)Math.Min(target.Length,length-position),written=0;
            while(written<requested)
            {
                int start=(int)(position%pattern.Length);
                int take=Math.Min(pattern.Length-start,requested-written);
                pattern.AsSpan(start,take).CopyTo(target.Slice(written,take));
                written+=take;position+=take;
            }
            return requested;
        }
        public override void Flush(){}
        public override long Seek(long offset,SeekOrigin origin)=>throw new NotSupportedException();
        public override void SetLength(long value)=>throw new NotSupportedException();
        public override void Write(byte[] buffer,int offset,int count)=>throw new NotSupportedException();
    }

    public static async Task VerifyAsync(HttpClient client,long folderId)
    {
        Check(NativeFileStore.MaxFileLength>TestBytes,
            "the configured capacity must exceed 2 GiB");
        byte[] pattern=new byte[1024*1024];
        for(int i=0;i<pattern.Length;i++)pattern[i]=(byte)(i*73+19);
        string expected;
        using(var hash=IncrementalHash.CreateHash(HashAlgorithmName.SHA256))
        {
            long remaining=TestBytes;
            while(remaining>0)
            {
                int length=(int)Math.Min(pattern.Length,remaining);
                hash.AppendData(pattern,0,length);
                remaining-=length;
            }
            expected=Convert.ToHexString(hash.GetHashAndReset());
        }
        Console.WriteLine("LARGE FILE SMOKE: starting streaming upload "+TestBytes+" bytes");
        using var generated=new RepeatingStream(TestBytes,pattern);
        using var req=new HttpRequestMessage(HttpMethod.Post,
            "/api/v2/files/company/upload?folderId="+folderId);
        req.Headers.TryAddWithoutValidation("X-File-Name",
            Uri.EscapeDataString("large-over-2GiB.bin"));
        req.Content=new StreamContent(generated);
        req.Content.Headers.ContentLength=TestBytes;
        using var uploaded=await client.SendAsync(req,
            HttpCompletionOption.ResponseHeadersRead);
        uploaded.EnsureSuccessStatusCode();
        var metadata=await uploaded.Content.ReadFromJsonAsync<JsonElement>();
        long fileId=metadata.GetProperty("fileId").GetInt64();
        Check(metadata.GetProperty("size").GetInt64()==TestBytes,
            "upload size truncated to Int32");
        Check(metadata.GetProperty("sha256").GetString()==expected,
            "upload SHA-256 mismatch");
        Console.WriteLine("LARGE FILE SMOKE: upload hash and length confirmed");
        using var response=await client.GetAsync(
            $"/api/v2/files/company/{fileId}/versions/1/download",
            HttpCompletionOption.ResponseHeadersRead);
        response.EnsureSuccessStatusCode();
        Check(response.Content.Headers.ContentLength==TestBytes,
            "download Content-Length truncated");
        await using var source=await response.Content.ReadAsStreamAsync();
        using var digest=IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        byte[] buffer=new byte[1024*1024];
        long received=0;
        int n;
        while((n=await source.ReadAsync(buffer))>0)
        {
            digest.AppendData(buffer,0,n);
            received+=n;
        }
        Check(received==TestBytes,"download byte count mismatch");
        Check(Convert.ToHexString(digest.GetHashAndReset())==expected,
            "download SHA-256 mismatch");
        Console.WriteLine("LARGE FILE SMOKE PASS: >2 GiB upload/download; constant-memory SHA-256");
    }
}
