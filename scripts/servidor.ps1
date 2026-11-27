<#
  Liga, desliga e mostra o estado do servidor do app (Tela dos Guri).
  Uso:  powershell -File scripts\servidor.ps1 ligar | desligar | status [-SemNavegador]
  Normalmente você não chama isto direto: use LIGAR.bat, DESLIGAR.bat e STATUS.bat (duplo clique).

  O que ele NÃO mexe: o serviço do Cloudflare Tunnel (cloudflared) continua como está. Com o app
  desligado, o endereço público mostra uma página de erro do Cloudflare (502), e é isso mesmo.
#>
[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [ValidateSet('ligar', 'desligar', 'status')]
  [string]$Acao = 'status',

  # Não abre o navegador depois de ligar (também vale a variável de ambiente TELA_SEM_NAVEGADOR=1).
  [switch]$SemNavegador
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

$raiz = Split-Path -Parent $PSScriptRoot
Set-Location $raiz

# --- configuração (só lê PORT e ALLOWED_ORIGIN do .env; nenhum segredo é lido nem exibido) ---
function Read-EnvValor([string]$chave, [string]$padrao) {
  $arquivo = Join-Path $raiz '.env'
  if (-not (Test-Path $arquivo)) { return $padrao }
  foreach ($linha in Get-Content $arquivo -Encoding UTF8) {
    if ($linha -match "^\s*$chave\s*=(.*)$") {
      $valor = ($Matches[1] -replace '\s+#.*$', '').Trim().Trim('"').Trim("'")
      if ($valor) { return $valor }
    }
  }
  return $padrao
}

$porta = [int](Read-EnvValor 'PORT' '3000')
$endereco = Read-EnvValor 'ALLOWED_ORIGIN' "http://localhost:$porta"
$logDir = Join-Path $raiz 'logs'
$logArquivo = Join-Path $logDir 'server.log'

function Test-PortaOcupada { [bool](Get-NetTCPConnection -LocalPort $porta -State Listen -ErrorAction SilentlyContinue) }

# Processos node DESTE projeto escutando na porta (distingue de outro programa na mesma porta).
function Get-ProcessosDoServidor {
  $achados = @()
  foreach ($conexao in Get-NetTCPConnection -LocalPort $porta -State Listen -ErrorAction SilentlyContinue) {
    $p = Get-CimInstance Win32_Process -Filter "ProcessId=$($conexao.OwningProcess)" -ErrorAction SilentlyContinue
    if ($p -and $p.CommandLine -match 'src[\\/]index\.ts') { $achados += $p }
  }
  return $achados
}

function Write-Ok([string]$texto) { Write-Host "  [OK] $texto" -ForegroundColor Green }
function Write-Aviso([string]$texto) { Write-Host "  [!]  $texto" -ForegroundColor Yellow }
function Write-Erro([string]$texto) { Write-Host "  [X]  $texto" -ForegroundColor Red }

function Show-Tunel {
  $servico = Get-Service -Name 'cloudflared' -ErrorAction SilentlyContinue
  if (-not $servico) {
    Write-Aviso 'Túnel (cloudflared): serviço não encontrado. Sem ele o endereço público não funciona (README, seção 5).'
  } elseif ($servico.Status -eq 'Running') {
    Write-Ok 'Túnel (cloudflared): rodando.'
  } else {
    Write-Aviso "Túnel (cloudflared): $($servico.Status). Inicie-o (PowerShell como administrador): Start-Service cloudflared"
  }
}

function Show-Status {
  Write-Host ''
  if (Test-PortaOcupada) {
    if (Get-ProcessosDoServidor) {
      Write-Ok "Servidor LIGADO (porta $porta)."
      Write-Host "       Endereço: $endereco"
    } else {
      Write-Erro "A porta $porta está ocupada por OUTRO programa (não é o servidor do app)."
    }
  } else {
    Write-Host '  [ ]  Servidor DESLIGADO.' -ForegroundColor Gray
    Write-Host '       Para ligar: LIGAR.bat'
  }
  Show-Tunel
  Write-Host ''
}

# --- build: só quando o código do front mudou desde o último build ---
function Test-BuildDesatualizado {
  $indice = Join-Path $raiz 'packages\web\dist\index.html'
  if (-not (Test-Path $indice)) { return $true }
  $feitoEm = (Get-Item $indice).LastWriteTime
  $fontes = @('packages\web\src', 'packages\web\public', 'packages\shared\src') |
    ForEach-Object { Join-Path $raiz $_ } |
    Where-Object { Test-Path $_ } |
    ForEach-Object { Get-ChildItem $_ -Recurse -File -ErrorAction SilentlyContinue }
  $fontes += Get-Item (Join-Path $raiz 'packages\web\index.html')
  $maisNovo = ($fontes | Measure-Object -Property LastWriteTime -Maximum).Maximum
  return ($maisNovo -gt $feitoEm)
}

function Invoke-Ligar {
  Write-Host ''
  if (-not (Test-Path (Join-Path $raiz '.env'))) {
    Write-Erro 'Falta o arquivo .env (copie .env.example para .env e preencha; veja o README).'
    exit 1
  }
  foreach ($comando in 'node', 'npm') {
    if (-not (Get-Command $comando -ErrorAction SilentlyContinue)) {
      Write-Erro "'$comando' não encontrado. Instale o Node.js (nodejs.org) e abra um terminal novo."
      exit 1
    }
  }
  if (-not (Test-Path (Join-Path $raiz 'node_modules'))) {
    Write-Erro 'Faltam as dependências. Rode uma vez, na pasta do projeto: npm install'
    exit 1
  }

  if (Test-PortaOcupada) {
    if (Get-ProcessosDoServidor) {
      Write-Ok 'O servidor já estava ligado.'
      Show-Status
      return
    }
    Write-Erro "A porta $porta está ocupada por outro programa. Feche-o ou mude a PORT no .env."
    exit 1
  }

  if (Test-BuildDesatualizado) {
    Write-Host '  Atualizando o site (build)... isso leva alguns segundos.'
    npm run build *> $null
    if ($LASTEXITCODE -ne 0) {
      Write-Erro 'O build falhou. Rode "npm run build" num terminal para ver o erro.'
      exit 1
    }
    Write-Ok 'Site atualizado.'
  }

  New-Item -ItemType Directory -Force $logDir | Out-Null
  # Evita o log crescer sem limite: passa de 5 MB, guarda o antigo e começa outro.
  if ((Test-Path $logArquivo) -and ((Get-Item $logArquivo).Length -gt 5MB)) {
    Move-Item $logArquivo (Join-Path $logDir 'server.old.log') -Force
  }

  Write-Host '  Ligando o servidor...'
  $pasta = $raiz.Replace("'", "''")
  Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden -ArgumentList @(
    '-NoProfile', '-WindowStyle', 'Hidden', '-Command',
    # UTF-8 para os nomes com acento saírem certos no log.
    "try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }; Set-Location '$pasta'; npm start *>> logs\server.log"
  ) | Out-Null

  $limite = (Get-Date).AddSeconds(25)
  while (-not (Test-PortaOcupada) -and (Get-Date) -lt $limite) { Start-Sleep -Milliseconds 500 }

  if (-not (Test-PortaOcupada)) {
    Write-Erro 'O servidor não subiu. Últimas linhas do log:'
    if (Test-Path $logArquivo) { Get-Content $logArquivo -Tail 12 | ForEach-Object { Write-Host "       $_" } }
    exit 1
  }

  Show-Status
  if (-not $SemNavegador -and -not $env:TELA_SEM_NAVEGADOR) { Start-Process $endereco }
}

function Invoke-Desligar {
  Write-Host ''
  $processos = Get-ProcessosDoServidor
  if (-not $processos) {
    if (Test-PortaOcupada) {
      Write-Erro "A porta $porta está ocupada por outro programa; não é o servidor do app, então não mexi nele."
      exit 1
    }
    Write-Ok 'O servidor já estava desligado.'
    Write-Host ''
    return
  }

  # Primeiro pede com educação (arquivo logs\desligar.flag): o servidor avisa todos, que voltam para a
  # tela de entrada, e encerra sozinho. Se não responder (versão antiga ou travado), encerra à força.
  New-Item -ItemType Directory -Force $logDir | Out-Null
  $pedido = Join-Path $logDir 'desligar.flag'
  New-Item -ItemType File -Force $pedido | Out-Null
  $espera = (Get-Date).AddSeconds(6)
  while ((Test-PortaOcupada) -and (Get-Date) -lt $espera) { Start-Sleep -Milliseconds 300 }
  Remove-Item $pedido -Force -ErrorAction SilentlyContinue

  if (Test-PortaOcupada) {
    foreach ($p in $processos) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
  }
  $limite = (Get-Date).AddSeconds(10)
  while ((Test-PortaOcupada) -and (Get-Date) -lt $limite) { Start-Sleep -Milliseconds 300 }

  if (Test-PortaOcupada) {
    Write-Erro 'Não consegui desligar. Encerre o processo "node" no Gerenciador de Tarefas.'
    exit 1
  }
  Write-Ok 'Servidor DESLIGADO. Quem estava na sala foi desconectado e precisará entrar de novo com a senha.'
  Write-Host '       (O túnel continua ativo, mas sem o app o endereço mostra um erro 502: é normal.)'
  Write-Host ''
}

switch ($Acao) {
  'ligar'    { Invoke-Ligar }
  'desligar' { Invoke-Desligar }
  'status'   { Show-Status }
}
