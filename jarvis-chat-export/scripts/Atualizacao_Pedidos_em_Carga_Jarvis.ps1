# ==============================================================================
# SCRIPT DE ATUALIZACAO AUTOMATICA E GERACAO DE COPIA LIMPA
# ROTINA: Pedidos em Carga
# COM INTEGRACAO DE LOGS COM JARVIS (HTTP INGEST)
# ==============================================================================

# --- 1. CONFIGURACOES DE CAMINHO ---
$caminhoLogTexto = "C:\Users\M.Trajano Bermuda\Desktop\Atualização de Planilhas\Log\Log_Pedidios_em_Carga.txt"
$caminhoBase = "G:\Meu Drive\Base_Ecommerce\Pedidos em Carga Base.xlsx"
$caminhoDownload = "G:\.shortcut-targets-by-id\1wuEF_LwjGeyjoz9qP1OfgRYzaXiWbL3z\E-COMMERCE Probel\17_Relatórios_Automáticos\Pedidos em Carga\Pedidos em Carga Download.xlsx"

# --- 1.1 INTEGRACAO JARVIS (HTTP INGEST) ---
$jarvisIngestUrl = "http://localhost:3001/api/log-ingest"
$jarvisToken = [Environment]::GetEnvironmentVariable("JARVIS_INGEST_API_TOKEN", "Machine")
if ([string]::IsNullOrWhiteSpace($jarvisToken)) {
    $jarvisToken = [Environment]::GetEnvironmentVariable("JARVIS_INGEST_API_TOKEN", "User")
}
$runId = "PedidosEmCarga-" + (Get-Date -Format "yyyyMMdd-HHmmss")
$eventosJarvis = New-Object System.Collections.Generic.List[Object]

# --- 2. FUNCAO DE LOG (ARQUIVO + TELA + BUFFER JARVIS) ---
function Write-Log($msg) {
    $agora = Get-Date
    $timestamp = $agora.ToString("dd/MM/yyyy HH:mm:ss")
    $horaLog = $agora.ToString("HH:mm:ss")
    $timestampIso = $agora.ToUniversalTime().ToString("o")

    # 1) Grava no arquivo de texto
    "[$timestamp] $msg" | Out-File -FilePath $caminhoLogTexto -Append -Encoding utf8

    # 2) Exibe na tela com formato limpo
    $linhaTela = "[$horaLog] $msg"
    $nivel = "INFO"

    if ($msg -match "\[ERRO") {
        Write-Host $linhaTela -ForegroundColor Red
        $nivel = "ERROR"
    }
    elseif ($msg -match "\[AVISO\]") {
        Write-Host $linhaTela -ForegroundColor Yellow
        $nivel = "WARN"
    }
    else {
        Write-Host $linhaTela -ForegroundColor Green
    }

    # 3) Acumula evento para enviar ao Jarvis
    $eventosJarvis.Add(@{
        timestamp  = $timestampIso
        automation = "Pedidos_em_Carga"
        level      = $nivel
        message    = $msg
        runId      = $runId
        tags       = @("excel", "powerquery", "agendador")
        meta       = @{
            script  = "Pedidos em Carga"
            host    = $env:COMPUTERNAME
            user    = $env:USERNAME
            logFile = $caminhoLogTexto
        }
    }) | Out-Null
}

# --- 2.1 ENVIO DE LOGS PARA O JARVIS ---
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

$excel = $null
$wb = $null

try {
    Write-Log "--- INICIANDO ATUALIZACAO: PEDIDOS EM CARGA ---"

    # --- 3. LIMPEZA PREVENTIVA ---
    Get-Process | Where-Object { $_.Name -like "*Mashup*" } | Stop-Process -Force -ErrorAction SilentlyContinue

    # --- 4. VALIDACAO DE CAMINHO ---
    if (-not (Test-Path -LiteralPath $caminhoBase)) {
        Write-Log "[ERRO CRITICO] Planilha base nao encontrada no caminho especificado."
        return
    }

    # --- 5. INICIALIZACAO DO EXCEL ---
    $excel = New-Object -ComObject Excel.Application
    $excel.Visible = $false
    $excel.DisplayAlerts = $false
    $excel.Interactive = $true
    $excel.EnableEvents = $false

    Write-Log "[STATUS] Abrindo arquivo base..."
    $wb = $excel.Workbooks.Open($caminhoBase)

    while (-not $excel.Ready) { Start-Sleep -Seconds 2 }

    # --- 6. PROCESSAMENTO DE DADOS (POWER QUERY) ---
    Write-Log "[STATUS] Iniciando RefreshAll (Processamento Global)..."
    $excel.ScreenUpdating = $false
    $wb.RefreshAll()

    Write-Log "[STATUS] Aguardando conclusao das consultas em segundo plano..."
    $timeout = 600
    $timer = [System.Diagnostics.Stopwatch]::StartNew()

    Do {
        Start-Sleep -Seconds 5
        $refrescando = $false
        foreach ($conn in $wb.Connections) {
            try {
                if ($conn.Type -eq 1 -and $conn.OLEDBConnection.Refreshing) { $refrescando = $true }
                if ($conn.Type -eq 2 -and $conn.ODBCConnection.Refreshing) { $refrescando = $true }
            }
            catch { }
        }
        if ($timer.Elapsed.TotalSeconds -gt $timeout) { break }
    } While ($refrescando)
    $timer.Stop()

    # Pausa de estabilizacao
    Write-Log "[STATUS] Estabilizando conexao COM..."
    Start-Sleep -Seconds 5

    # --- 7. CARIMBO DE DATA/HORA ---
    try {
        if ($excel -ne $null -and $wb -ne $null) {
            $sheetLog = $wb.Sheets.Item("Log")
            try { $sheetLog.Unprotect() } catch {}
            $dataAgora = Get-Date -Format "dd/MM/yyyy - HH:mm:ss"
            $sheetLog.Cells.Item(1, 1).Value2 = "Base Atualizada em:"
            $sheetLog.Cells.Item(1, 2).NumberFormat = "@"
            $sheetLog.Cells.Item(1, 2).Value2 = $dataAgora
            Write-Log "[STATUS] Carimbo de data aplicado na aba 'Log'."
        }
    }
    catch {
        Write-Log "[AVISO] Falha ao aplicar carimbo (Conexao instavel)."
    }

    # --- 8. GERACAO DE COPIA LIMPA (SEM CONSULTAS) ---
    Write-Log "[STATUS] Iniciando geracao de copia limpa e segura..."
    try {
        $wbLimpo = $excel.Workbooks.Add()

        # INSIRA AQUI OS NOMES EXATOS DAS ABAS QUE DEVEM IR PARA O DOWNLOAD
        $abasParaCopiar = @("Log", "Base")

        foreach ($nomeAba in $abasParaCopiar) {
            try {
                $wsOriginal = $wb.Sheets.Item($nomeAba)

                # Cria a aba nova no arquivo limpo
                $wsNova = $wbLimpo.Sheets.Add([System.Reflection.Missing]::Value, $wbLimpo.Sheets.Item($wbLimpo.Sheets.Count))
                $wsNova.Name = $nomeAba

                # Copia a malha inteira de celulas da original
                $wsOriginal.Cells.Copy() | Out-Null

                # Cola separadamente para garantir que as consultas nao venham
                $wsNova.Range("A1").PasteSpecial(-4122) | Out-Null # Formatos e Cores
                $wsNova.Range("A1").PasteSpecial(8) | Out-Null     # Largura das Colunas
                $wsNova.Range("A1").PasteSpecial(-4163) | Out-Null # Somente Valores

                # Tenta copiar a cor da guia da aba
                try { $wsNova.Tab.Color = $wsOriginal.Tab.Color } catch {}

                Write-Log "[STATUS] -> Aba '$nomeAba' clonada com sucesso."
            }
            catch {
                Write-Log "[AVISO] -> Falha ao clonar a aba '$nomeAba'. Erro: $($_.Exception.Message)"
            }
        }

        # Ajustes finais de interface
        try { $wbLimpo.TabRatio = 0.8 } catch {}
        try { $wbLimpo.Sheets.Item(1).Activate() } catch {}

        # Remove abas padrao
        try { $wbLimpo.Sheets.Item("Planilha1").Delete() } catch {}
        try { $wbLimpo.Sheets.Item("Sheet1").Delete() } catch {}

        # Salva o arquivo limpo e fecha
        $wbLimpo.SaveAs($caminhoDownload, 51)
        $wbLimpo.Close($false)
        Write-Log "[STATUS] Copia limpa salva com sucesso no destino."
    }
    catch {
        Write-Log "[ERRO] Falha ao gerar a copia limpa: $($_.Exception.Message)"
    }

    # --- 9. FINALIZACAO E SALVAMENTO ---
    Write-Log "[STATUS] Salvando e liberando arquivo..."
    if ($wb -ne $null) {
        $wb.Save()
        $wb.Close($true)
    }
    $excel.Quit()

    Write-Log "=== SUCESSO TOTAL: PEDIDOS EM CARGA ATUALIZADO ==="
}
catch {
    Write-Log "[ERRO GERAL] $($_.Exception.Message)"
}
finally {
    # --- 10. LIMPEZA PROFUNDA DE PROCESSOS E MEMORIA ---
    if ($excel -ne $null) {
        try { $excel.EnableEvents = $true } catch {}
        $excel.Interactive = $true
    }

    Get-Process | Where-Object { $_.Name -like "*Mashup*" } | Stop-Process -Force -ErrorAction SilentlyContinue

    if ($wb -ne $null) { [System.Runtime.Interopservices.Marshal]::ReleaseComObject($wb) | Out-Null }
    if ($excel -ne $null) { [System.Runtime.Interopservices.Marshal]::ReleaseComObject($excel) | Out-Null }

    [System.GC]::Collect()
    [System.GC]::WaitForPendingFinalizers()

    Stop-Process -Name "EXCEL" -ErrorAction SilentlyContinue
    $wb = $null
    $excel = $null

    # Envia todo o lote de logs para o Jarvis ao final da rotina
    Send-LogsToJarvis -Eventos $eventosJarvis
}
