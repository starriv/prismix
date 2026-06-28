# Prismix — Local Development Makefile
#
# Quick start:
#   make              # = make dev (前台启动全套)
#   make stop         # 停止全部
#   make status       # 查看状态
#   make help         # 完整命令列表

.DEFAULT_GOAL := dev

API_PORT    := 3403
WEB_PORT    := 5189
WORKER_PORT := 3404
PG_PORT     := 15433
REDIS_PORT  := 16378
ALL_PORTS   := $(API_PORT),$(WEB_PORT),$(WORKER_PORT),$(PG_PORT),$(REDIS_PORT)
LOG_DIR     := .logs

C_RESET := \033[0m
C_CYAN  := \033[36m
C_GREEN := \033[32m
C_RED   := \033[31m
C_YELL  := \033[33m

.PHONY: dev dev-bg stop restart status logs db-reset db-studio clean help

dev:  ## 启动全套（前台，热更新，颜色日志）
	pnpm dev

dev-bg:  ## 后台启动，日志写入 .logs/
	@mkdir -p $(LOG_DIR)
	@bash scripts/dev-services.sh start >/dev/null
	@nohup pnpm dev:server > $(LOG_DIR)/api.log 2>&1 & \
		printf "$(C_GREEN)✓ api  PID=$$!$(C_RESET)\n"
	@nohup pnpm dev:web:wait > $(LOG_DIR)/web.log 2>&1 & \
		printf "$(C_GREEN)✓ web  PID=$$!$(C_RESET)\n"
	@nohup pnpm dev:worker > $(LOG_DIR)/worker.log 2>&1 & \
		printf "$(C_GREEN)✓ worker PID=$$!$(C_RESET)\n"
	@sleep 1
	@printf "\n$(C_CYAN)make logs 查看日志 | make stop 停止$(C_RESET)\n"

stop:  ## 停止全部（kill 应用端口 + docker down）
	@bash scripts/dev-services.sh stop

restart: stop  ## 重启（stop → dev）
	@sleep 1
	@$(MAKE) dev

status:  ## 端口 + Docker + 健康检查
	@printf "$(C_CYAN)=== 端口监听 ===$(C_RESET)\n"
	@lsof -nP -iTCP:$(ALL_PORTS) -sTCP:LISTEN 2>/dev/null || printf "  $(C_YELL)(无)$(C_RESET)\n"
	@printf "\n$(C_CYAN)=== Docker 容器 ===$(C_RESET)\n"
	@docker compose ps 2>/dev/null || printf "  $(C_YELL)(无)$(C_RESET)\n"
	@printf "\n$(C_CYAN)=== 健康检查 ===$(C_RESET)\n"
	@curl -sS -m 2 http://localhost:$(API_PORT)/api/health 2>/dev/null && printf "\n" || printf "  $(C_YELL)API: 未响应$(C_RESET)\n"
	@curl -sS -m 2 http://localhost:$(WORKER_PORT)/health 2>/dev/null && printf "\n" || printf "  $(C_YELL)Worker: 未响应$(C_RESET)\n"

logs:  ## tail 后台日志（dev-bg 模式）
	@tail -f $(LOG_DIR)/api.log $(LOG_DIR)/web.log $(LOG_DIR)/worker.log 2>/dev/null \
		|| printf "$(C_YELL)无日志，请先 make dev-bg$(C_RESET)\n"

db-reset:  ## 重置数据库（DROP SCHEMA + 重新迁移）
	pnpm db:reset

db-studio:  ## Drizzle Studio
	pnpm db:studio

clean: stop  ## 停止 + 删除 docker volumes（数据全丢）
	@docker compose down -v

help:  ## 显示此帮助
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "} {printf "  $(C_CYAN)%-12s$(C_RESET) %s\n", $$1, $$2}'
