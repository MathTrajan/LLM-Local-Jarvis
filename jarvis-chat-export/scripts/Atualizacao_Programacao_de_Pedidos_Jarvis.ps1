# ==============================================================================
# ROTINA: Programacao de Pedidos
# COM INTEGRACAO DE LOGS COM JARVIS (HTTP INGEST)
# ==============================================================================

$caminhoLogTexto = "D:\automacao\Log\Log_Prog_Pedidos.txt"
$caminhoBase     = "D:\automacao\base\Programacao de Pedidos Base.xlsx"
$caminhoDownload = "D:\automacao\saida\Programacao de Pedidos Download.xlsx"
$caminhoUpload   = "D:\automacao\scripts\lib\upload-prog-pedidos.ps1"

# URL do Jarvis. Se a variavel JARVIS_INGEST_URL existir no servidor, ela tem prioridade.
$jarvisIngestUrl = [Environment]::GetEnvironmentVariable("JARVIS_INGEST_URL", "Machine")
if ([string]::IsNullOrWhiteSpace($jarvisIngestUrl)) {
    $jarvisIngestUrl = [Environment]::GetEnvironmentVariable("JARVIS_INGEST_URL", "User")
}
if ([string]::IsNullOrWhiteSpace($jarvisIngestUrl)) {
    $jarvisIngestUrl = "http://localhost:3000/api/log-ingest"
}

$jarvisToken = [Environment]::GetEnvironmentVariable("JARVIS_INGEST_API_TOKEN", "Machine")
if ([string]::IsNullOrWhiteSpace($jarvisToken)) {
    $jarvisToken = [Environment]::GetEnvironmentVariable("JARVIS_INGEST_API_TOKEN", "User")
}

$runId = "ProgramacaoPedidos-" + (Get-Date -Format "yyyyMMdd-HHmmss")
$eventosJarvis = New-Object System.Collections.Generic.List[Object]

function Get-LogLevelFromMessage {
    param([string]$Message)

    if ($Message -match "\[ERRO") { return "ERROR" }
    if ($Message -match "\[AVISO\]") { return "WARN" }
    return "INFO"
}

function Get-LogStatusFromMessage {
    param([string]$Message)

    if ($Message -match "SUCESSO TOTAL") { return "success" }
    if ($Message -match "\[ERRO CRITICO\]") { return "critical_error" }
    if ($Message -match "\[ERRO GERAL\]") { return "error" }
    if ($Message -match "\[ERRO\]") { return "error" }
    if ($Message -match "\[AVISO\]") { return "warning" }
    if ($Message -match "\[STATUS\]") { return "running" }
    return "info"
}

function Get-ErrorCodeFromMessage {
    param([string]$Message)

    if ($Message -match "Planilha base nao encontrada") { return "BASE_NOT_FOUND" }
    if ($Message -match "Falha na geracao da copia") { return "COPY_GENERATION_FAILED" }
    if ($Message -match "Upload para o Drive falhou") { return "DRIVE_UPLOAD_FAILED" }
    if ($Message -match "Falha ao executar script de upload") { return "DRIVE_UPLOAD_SCRIPT_FAILED" }
    if ($Message -match "Timeout atingido") { return "REFRESH_TIMEOUT" }
    if ($Message -match "Falha apos .* tentativas de") { return "COM_RETRY_EXHAUSTED" }
    if ($Message -match "\[ERRO GERAL\]") { return "GENERAL_FAILURE" }
    return $null
}

function Write-Log($msg) {
    $agora = Get-Date
    $timestamp = $agora.ToString("dd/MM/yyyy HH:mm:ss")
    $horaLog = $agora.ToString("HH:mm:ss")
    $timestampIso = $agora.ToUniversalTime().ToString("o")

    "[$timestamp] $msg" | Out-File -FilePath $caminhoLogTexto -Append -Encoding utf8

    $linhaTela = "[$horaLog] $msg"
    $nivel = Get-LogLevelFromMessage -Message $msg
    $status = Get-LogStatusFromMessage -Message $msg
    $errorCode = Get-ErrorCodeFromMessage -Message $msg

    if ($nivel -eq "ERROR") {
        Write-Host $linhaTela -ForegroundColor Red
    }
    elseif ($nivel -eq "WARN") {
        Write-Host $linhaTela -ForegroundColor Yellow
    }
    else {
        Write-Host $linhaTela -ForegroundColor Green
    }

    $eventosJarvis.Add(@{
        timestamp  = $timestampIso
        automation = "Programacao_de_Pedidos"
        level      = $nivel
        message    = $msg
        runId      = $runId
        status     = $status
        errorCode  = $errorCode
        tags       = @("excel", "powerquery", "programacao-pedidos")
        meta       = @{
            script       = "Programacao de Pedidos"
            host         = $env:COMPUTERNAME
            user         = $env:USERNAME
            logFile      = $caminhoLogTexto
            baseFile     = $caminhoBase
            downloadFile = $caminhoDownload
        }
    }) | Out-Null
}

function Send-LogsToJarvis {
    param([System.Collections.Generic.List[Object]]$Eventos)

    if ($null -eq $Eventos -or $Eventos.Count -eq 0) {
        return
    }

    if ([string]::IsNullOrWhiteSpace($jarvisToken)) {
        Write-Host "[JARVIS] Token ausente (variavel JARVIS_INGEST_API_TOKEN). Logs nao enviados." -ForegroundColor Magenta
        return
    }

    $payload = @{ events = $Eventos } | ConvertTo-Json -Depth 8

    try {
        $resp = Invoke-RestMethod -Uri $jarvisIngestUrl `
            -Method Post `
            -ContentType "application/json" `
            -Headers @{ Authorization = "Bearer $jarvisToken" } `
            -Body $payload `
            -TimeoutSec 20

        Write-Host "[JARVIS] Logs enviados. accepted=$($resp.accepted) rejected=$($resp.rejected)" -ForegroundColor Cyan
    }
    catch {
        Write-Host "[JARVIS] Falha ao enviar logs: $($_.Exception.Message)" -ForegroundColor Magenta
    }
}

function Invoke-ComWithRetry {
    param(
        [scriptblock]$Action,
        [int]$MaxAttempts = 10,
        [int]$DelaySeconds = 3,
        [string]$Description = "operacao COM"
    )

    for ($i = 1; $i -le $MaxAttempts; $i++) {
        try {
            return & $Action
        }
        catch [System.Runtime.InteropServices.COMException] {
            $hresult = $_.Exception.HResult
            if ($hresult -eq 0x80010001 -or $hresult -eq -2147418111 -or $hresult -eq -2147417846) {
                Write-Log "[AVISO] Tentativa $i/$MaxAttempts de $Description rejeitada. Aguardando $DelaySeconds s..."
                Start-Sleep -Seconds $DelaySeconds
                continue
            }
            throw
        }
    }

    throw "Falha apos $MaxAttempts tentativas de $Description"
}

$excel = $null
$wb = $null

try {
    Write-Log "--- INICIANDO ATUALIZACAO: PROGRAMACAO DE PEDIDOS ---"

    Get-Process -Name "EXCEL" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Get-Process | Where-Object { $_.Name -like "*Mashup*" } | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2

    if (-not (Test-Path -LiteralPath $caminhoBase)) {
        Write-Log "[ERRO CRITICO] Planilha base nao encontrada em: $caminhoBase"
        return
    }

    Write-Log "[STATUS] Abrindo instancia do Excel..."
    $excel = New-Object -ComObject Excel.Application
    $excel.Visible = $false
    $excel.DisplayAlerts = $false
    $excel.Interactive = $true
    $excel.EnableEvents = $false
    Start-Sleep -Seconds 3

    Write-Log "[STATUS] Abrindo arquivo base..."
    $wb = Invoke-ComWithRetry -Description "abertura do arquivo base" -Action { $excel.Workbooks.Open($caminhoBase) }
    while (-not $excel.Ready) { Start-Sleep -Seconds 2 }
    Start-Sleep -Seconds 3

    Write-Log "[STATUS] Iniciando RefreshAll (Processamento Global)..."
    $excel.ScreenUpdating = $false
    Invoke-ComWithRetry -Description "RefreshAll" -Action { $wb.RefreshAll() }

    Write-Log "[STATUS] Aguardando conclusao das consultas e estabilizacao..."
    $timeout = 1500
    $timer = [System.Diagnostics.Stopwatch]::StartNew()
    Do {
        Start-Sleep -Seconds 5
        $refrescando = $false
        foreach ($conn in $wb.Connections) {
            try {
                if ($conn.Type -eq 1 -and $conn.OLEDBConnection.Refreshing) { $refrescando = $true }
                if ($conn.Type -eq 2 -and $conn.ODBCConnection.Refreshing) { $refrescando = $true }
            } catch { }
        }
        if ($timer.Elapsed.TotalSeconds -gt $timeout) {
            Write-Log "[AVISO] Timeout atingido. Tentando prosseguir."
            break
        }
    } While ($refrescando)
    $timer.Stop()
    Start-Sleep -Seconds 5

    try {
        if ($excel -ne $null -and $wb -ne $null) {
            $sheetLog = $wb.Sheets.Item("Log")
            $dataAgora = Get-Date -Format "dd/MM/yyyy - HH:mm:ss"
            $sheetLog.Cells.Item(1, 1).Value2 = "Base Atualizada em:"
            $sheetLog.Cells.Item(1, 2).NumberFormat = "@"
            $sheetLog.Cells.Item(1, 2).Value2 = $dataAgora
            Write-Log "[STATUS] Carimbo de data aplicado na aba 'Log'."
        }
    } catch {
        Write-Log "[AVISO] Falha ao aplicar carimbo na aba 'Log'."
    }

    Write-Log "[STATUS] Iniciando geracao de copia limpa..."
    $copiaGerada = $false
    try {
        $wbLimpo = $excel.Workbooks.Add()
        $abasParaCopiar = @("Log", "Pedidos Sem Carga")

        foreach ($nomeAba in $abasParaCopiar) {
            try {
                $wsOriginal = $wb.Sheets.Item($nomeAba)
                $wsNova = $wbLimpo.Sheets.Add([System.Reflection.Missing]::Value, $wbLimpo.Sheets.Item($wbLimpo.Sheets.Count))
                $wsNova.Name = $nomeAba
                $wsOriginal.Cells.Copy() | Out-Null
                $wsNova.Range("A1").PasteSpecial(-4122) | Out-Null
                $wsNova.Range("A1").PasteSpecial(8) | Out-Null
                $wsNova.Range("A1").PasteSpecial(-4163) | Out-Null
                try { $wsNova.Tab.Color = $wsOriginal.Tab.Color } catch {}
                Write-Log "[STATUS] -> Aba '$nomeAba' clonada com sucesso."
            } catch {
                Write-Log "[AVISO] -> Falha ao clonar a aba '$nomeAba'. Erro: $($_.Exception.Message)"
            }
        }

        try { $wbLimpo.TabRatio = 0.8 } catch {}
        try { $wbLimpo.Sheets.Item(1).Activate() } catch {}
        try { $wbLimpo.Sheets.Item("Planilha1").Delete() } catch {}
        try { $wbLimpo.Sheets.Item("Sheet1").Delete() } catch {}

        $wbLimpo.SaveAs($caminhoDownload, 51)
        $wbLimpo.Close($false)
        Write-Log "[STATUS] Copia limpa salva localmente em: $caminhoDownload"
        $copiaGerada = $true
    } catch {
        Write-Log "[ERRO] Falha na geracao da copia: $($_.Exception.Message)"
    }

    Write-Log "[STATUS] Salvando e fechando arquivo base..."
    if ($wb -ne $null) {
        $wb.Save()
        $wb.Close($true)
        $wb = $null
    }
    $excel.Quit()
    $excel = $null

    if ($copiaGerada) {
        Write-Log "[STATUS] Iniciando upload para o Google Drive via API..."
        try {
            $uploadOutput = & $caminhoUpload -FileToUpload $caminhoDownload 2>&1
            $uploadExitCode = $LASTEXITCODE
            foreach ($linha in $uploadOutput) {
                Write-Log "  $linha"
            }
            if ($uploadExitCode -eq 0) {
                Write-Log "[STATUS] Upload para o Drive concluido com sucesso."
            }
            else {
                Write-Log "[ERRO] Upload para o Drive falhou (exit code: $uploadExitCode)."
            }
        } catch {
            Write-Log "[ERRO] Falha ao executar script de upload: $($_.Exception.Message)"
        }
    }
    else {
        Write-Log "[AVISO] Upload para o Drive ignorado porque a copia limpa nao foi gerada."
    }

    Write-Log "=== SUCESSO TOTAL: PROGRAMACAO DE PEDIDOS ATUALIZADA ==="
}
catch {
    Write-Log "[ERRO GERAL] $($_.Exception.Message)"
}
finally {
    if ($excel -ne $null) {
        try { $excel.EnableEvents = $true } catch {}
        try { $excel.Interactive = $true } catch {}
    }

    Get-Process | Where-Object { $_.Name -like "*Mashup*" } | Stop-Process -Force -ErrorAction SilentlyContinue

    if ($wb -ne $null) { [System.Runtime.Interopservices.Marshal]::ReleaseComObject($wb) | Out-Null }
    if ($excel -ne $null) { [System.Runtime.Interopservices.Marshal]::ReleaseComObject($excel) | Out-Null }

    [System.GC]::Collect()
    [System.GC]::WaitForPendingFinalizers()

    Stop-Process -Name "EXCEL" -ErrorAction SilentlyContinue
    $wb = $null
    $excel = $null

    Send-LogsToJarvis -Eventos $eventosJarvis
}
