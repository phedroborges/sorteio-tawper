# Sorteio Tawper

Cadastro de participantes e sorteio do kit churrasco, com a identidade visual da Tawper. Aplicação completa para **EasyPanel em uma VPS**: frontend, API e banco SQLite no mesmo container. Não depende de Supabase, Vercel ou serviços pagos externos.

[Página no celular](docs/preview/cadastro-mobile.png) · [Painel de participantes](docs/preview/admin-desktop.png) · [Tela do ganhador](docs/preview/sorteio-resultado.png)

As prévias do painel utilizam dados fictícios de teste. O banco de produção começa vazio.

## O que está pronto

- **`/`**: página mobile first, foto do kit, nome completo, telefone brasileiro com máscara e validação, cargo, empresa e confirmação de inscrição.
- **`/admin`**: lista atualizada a cada 5 segundos, busca, paginação, edição, exclusão com confirmação e exportação CSV compatível com Excel.
- Abertura e encerramento das inscrições pelo painel.
- Sorteio com **10 segundos**, primeiros nomes passando na tela, modo tela cheia, ganhador em destaque e histórico persistente.
- Uma inscrição por telefone. Ganhadores anteriores não participam novamente.
- Banco real no servidor. Os cadastros são compartilhados por todos os aparelhos.
- Dockerfile e verificações automáticas pelo GitHub Actions.

## Subir no EasyPanel

1. Crie um serviço **App**.
2. Em **Source → GitHub**, selecione `phedroborges/sorteio-tawper`, branch **`main`**, build path **`/`**.
3. Em **Build**, escolha **Dockerfile**, arquivo **`Dockerfile`** na raiz.
4. Em **Storage**, adicione um **Volume** chamado `tawper-data`, com **mount path `/app/data`**. Faça isso **antes de receber inscrições**: é esse volume que mantém os dados entre deploys.
5. Configure o domínio `tawper.metricz.com.br`, apontando para a porta interna **`3000`**, protocolo interno **HTTP**, com **HTTPS público** habilitado. O DNS do subdomínio deve apontar para sua VPS.
6. Mantenha **1 réplica** do serviço. Use implantação que encerra o container anterior antes de iniciar o novo (desative zero-downtime para este serviço).
7. Em **Environment**, use:

```dotenv
NODE_ENV=production
PORT=3000
HOST=0.0.0.0
DATABASE_PATH=/app/data/tawper.sqlite
TRUST_PROXY=1
PUBLIC_ORIGIN=https://tawper.metricz.com.br
```

8. Clique em **Deploy**. O health check consulta `/health`. Não há comando de build adicional nem migração manual: o banco é criado automaticamente no volume.

Depois do deploy:

- Cadastro: `https://tawper.metricz.com.br/`
- Painel: `https://tawper.metricz.com.br/admin`

Se usar primeiro o domínio temporário do EasyPanel, configure `PUBLIC_ORIGIN` com a origem temporária, ou deixe a variável ausente até definir o domínio final. Se configurada, a variável deve coincidir exatamente com o endereço usado no navegador, **sem barra final**. Isso impede requisições de alteração vindas de outros sites.

O runtime usa o usuário `node` (UID 1000). Um volume novo normalmente recebe as permissões da imagem. Se montar uma pasta já existente da VPS, ela precisa permitir escrita para o UID 1000.

Referência: [serviços App, GitHub, domínios e volumes no EasyPanel](https://easypanel.io/docs/services/app).

## Operar no evento

1. Abra `/admin` e confirme que as inscrições estão abertas.
2. Compartilhe o QR code que já aponta para o endereço público.
3. Acompanhe os cadastros. **Exportar CSV** baixa a lista completa, inclusive se houver uma busca ativa no painel.
4. Se quiser fechar o cadastro antes do sorteio, clique em **Encerrar inscrições**.
5. Abra **Sorteio → Iniciar sorteio → Começar os 10 segundos**. Use **Tela cheia** para projetar.
6. O ganhador aparece na tela e fica no **Histórico**. É possível reabrir o resultado sem sortear novamente.

Cada nova rodada exclui os ganhadores anteriores. Quem se cadastrar depois do início de uma rodada entra somente nas próximas. Editar ou excluir cadastros durante a contagem fica bloqueado. A exclusão de um cadastro não apaga resultados anteriores do histórico.

**Acesso conforme solicitado:** não há login ou senha. Não há link para o painel na página pública, e o painel envia instruções para não ser indexado. `/admin` e suas APIs são acessíveis a qualquer pessoa que souber o endereço; ocultar o link não é autenticação.

## Como a aleatoriedade funciona

O servidor reúne os cadastros elegíveis dentro de uma transação SQLite, congela essa lista e escolhe um índice usando `crypto.randomInt`, que evita viés de módulo. Cada telefone elegível tem a mesma chance. O navegador apenas apresenta a animação — ele não escolhe o ganhador.

O vencedor e a lista da rodada ficam registrados antes da animação, mas a API não revela o vencedor até passarem **10.000 ms no servidor**. Um índice único impede duas rodadas simultâneas. Repetir a mesma requisição não sorteia outra pessoa. Recarregar a página ou reiniciar o processo mantém o resultado e o prazo originais. Um hash SHA-256 identifica a lista congelada; ele é um registro interno, não uma certificação externa de auditoria.

Referência técnica: [Node.js — crypto.randomInt](https://nodejs.org/api/crypto.html#cryptorandomintmin-max-callback).

## Rodar localmente

Requer **Node.js 24**.

```sh
npm ci
npm start
```

Abra `http://localhost:3000` e `http://localhost:3000/admin`. O banco local fica em `data/tawper.sqlite`, ignorado pelo Git. Para desenvolvimento com reinício automático: `npm run dev`.

Também é possível usar Docker:

```sh
docker compose up -d --build
```

O Compose cria o volume persistente `tawper-data` automaticamente. No EasyPanel, use o Dockerfile e crie o volume na interface conforme as instruções acima.

## Verificação

```sh
npm run check
npm test
npx playwright install chromium
npm run test:e2e
```

Os testes cobrem telefone, duplicidade, CSV com acentos e proteção contra fórmulas, fechamento de inscrições, edições, exclusões, recuperação após reinício, sorteios concorrentes e resultado indisponível antes dos 10 segundos. O teste no navegador percorre o cadastro pelo celular, painel, edição, exportação, contagem real, recarga durante o sorteio, histórico e operação das inscrições. Os testes usam bancos temporários ou em memória, nunca o banco de produção.

O GitHub Actions também monta a imagem Docker de produção, cadastra um participante fictício e recria o container com o mesmo volume para verificar a persistência.

## Persistência e backup

Todo o estado fica em `/app/data/tawper.sqlite` e nos arquivos auxiliares SQLite no **mesmo volume**. Não remova o volume ao atualizar o serviço. A exportação CSV preserva os leads, mas não substitui um backup do banco com o histórico dos sorteios.

Para gerar um backup consistente, execute no Shell do serviço:

```sh
node server/backup.js
```

O comando grava uma cópia em `/app/data/backups/`. Configure o backup desse volume no EasyPanel para armazenamento fora da VPS. Para restaurar, pare a aplicação, preserve uma cópia dos dados atuais e restaure o arquivo de backup como `tawper.sqlite` em um volume limpo, sem arquivos `-wal`/`-shm` antigos. Depois inicie novamente.

## Estrutura

```text
public/          Páginas, estilos, JavaScript e imagens
server/          API, validações, sorteio e banco SQLite
test/            Testes de regras, HTTP e navegador
Dockerfile       Imagem de produção para EasyPanel
compose.yaml     Execução local com Docker
```

As imagens e a marca Tawper pertencem aos seus titulares. A fonte Manrope utiliza a licença SIL OFL, incluída em `public/assets/OFL-Manrope.txt`. O repositório não contém dados de participantes nem credenciais.
