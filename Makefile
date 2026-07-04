# LabMate — 빌드/배포/운영 자동화
# 사용법: `make <target>`  (예: make up)  ·  `make help` 로 전체 명령 확인

COMPOSE       := docker compose
GATEWAY_PORT  := $(shell grep -E '^GATEWAY_PORT=' .env 2>/dev/null | cut -d= -f2)
GATEWAY_PORT  := $(or $(GATEWAY_PORT),8080)
BASE          := http://localhost:$(GATEWAY_PORT)
SERVICES      := members projects funds attendance boards resource
APP_SERVICES  := members-service projects-service funds-service attendance-service boards-service resource-service
TS            := $(shell date +%Y%m%d-%H%M%S)

# 컨테이너 레지스트리 (이미지: $(ORG)/labmate-<service>:$(VERSION))
ORG           ?= boanlab
VERSION       ?= v0.1
export ORG VERSION          # docker-compose 의 ${ORG}/${VERSION} 치환에 전달

.DEFAULT_GOAL := help

## ─── 기본 ───
.PHONY: help
help: ## 사용 가능한 명령 목록
	@echo "LabMate 명령어 (gateway: $(BASE)) — 관리자: labmate@kloud.zone / labmate123"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
	  | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

.PHONY: env
env: ## .env 없으면 .env.example 에서 생성
	@test -f .env || (cp .env.example .env && echo ".env 생성됨 — 비밀번호/시크릿을 수정하세요")

## ─── 빌드/배포 ───
.PHONY: build
build: env ## 모든 이미지 빌드
	$(COMPOSE) build

.PHONY: up
up: env ## 레지스트리 이미지 pull 후 기동(기본, VERSION 지정 가능)
	$(COMPOSE_PROD) pull
	$(COMPOSE_PROD) up -d --remove-orphans
	@$(COMPOSE_PROD) restart gateway >/dev/null 2>&1 && echo "gateway 재시작됨"
	@echo "기동 완료 → $(BASE)  (이미지: $(ORG)/labmate-*:$(or $(VERSION),latest))"

.PHONY: dev-up
dev-up: env ## 소스에서 빌드 후 기동(개발 — 소스 마운트·리로드)
	$(COMPOSE) up -d --build --remove-orphans
	@$(MAKE) --no-print-directory gateway-restart
	@echo "개발 기동 완료 → $(BASE)"

.PHONY: deploy
deploy: up ## up 별칭(pull 배포)

.PHONY: gateway-restart
gateway-restart: ## 게이트웨이 재시작(백엔드 재빌드 후 stale-IP 해소)
	@$(COMPOSE) restart gateway >/dev/null 2>&1 && echo "gateway 재시작됨"

## ─── 이미지 배포(레지스트리) ───
.PHONY: build-images
build-images: ## 배포용 이미지 빌드 → $(ORG)/labmate-<service>:{$(VERSION),latest}
	@for s in $(SERVICES); do \
	  echo "build $(ORG)/labmate-$$s:$(VERSION) (+latest)"; \
	  docker build -f backend/services/$$s/Dockerfile \
	    -t $(ORG)/labmate-$$s:$(VERSION) -t $(ORG)/labmate-$$s:latest backend || exit 1; \
	done
	@echo "build $(ORG)/labmate-frontend:$(VERSION) (+latest)"
	docker build -t $(ORG)/labmate-frontend:$(VERSION) -t $(ORG)/labmate-frontend:latest frontend

.PHONY: push-images
push-images: ## 빌드된 이미지 푸시($(VERSION) + latest, docker login 필요)
	@for s in $(SERVICES); do \
	  docker push $(ORG)/labmate-$$s:$(VERSION) || exit 1; \
	  docker push $(ORG)/labmate-$$s:latest || exit 1; \
	done
	docker push $(ORG)/labmate-frontend:$(VERSION)
	docker push $(ORG)/labmate-frontend:latest

.PHONY: release
release: build-images push-images ## 이미지 빌드 + 푸시

# 레지스트리 배포는 dev 오버라이드(소스 마운트) 없이 base compose만 사용
COMPOSE_PROD := $(COMPOSE) -f docker-compose.yml

.PHONY: pull
pull: ## 레지스트리에서 푸시한 이미지 받기(VERSION 기본 latest)
	$(COMPOSE_PROD) pull

.PHONY: prod-down
prod-down: ## 레지스트리 배포 중지/제거(데이터 유지)
	$(COMPOSE_PROD) down --remove-orphans

## ─── 운영 ───
.PHONY: stop
stop: ## 컨테이너 중지(데이터 유지)
	$(COMPOSE) stop

.PHONY: down
down: ## 컨테이너 제거(볼륨/데이터는 유지)
	$(COMPOSE) down --remove-orphans

.PHONY: restart
restart: ## 전체 재시작
	$(COMPOSE) restart

.PHONY: ps
ps: ## 컨테이너 상태
	$(COMPOSE) ps

.PHONY: logs
logs: ## 전체 로그 follow (S=서비스명 지정 가능: make logs S=members-service)
	$(COMPOSE) logs -f --tail=100 $(S)

.PHONY: health
health: ## 6개 서비스 헬스체크
	@for s in $(SERVICES); do \
	  code=$$(curl -s -o /dev/null -w '%{http_code}' $(BASE)/api/$$s/health); \
	  echo "  $$s: $$code"; \
	done

## ─── 데이터 ───
.PHONY: seed
seed: ## 관리자 계정 시드(.env 의 ADMIN_EMAIL/ADMIN_PASSWORD, 멱등)
	$(COMPOSE) exec members-service python -m app.seed

.PHONY: backup
backup: ## 전체 백업(DB + 첨부파일) → data/backups/labmate_YYYYmmdd-HHMMSS.tar.gz
	@$(COMPOSE) exec -T postgres pg_dumpall -U labmate | docker run --rm -i -v $(PWD)/data:/data alpine sh -c \
	  'mkdir -p /data/backups && cat > /data/db.sql && tar -czf /data/backups/labmate_$(TS).tar.gz -C /data db.sql uploads && rm -f /data/db.sql'
	@echo "백업(DB+첨부): data/backups/labmate_$(TS).tar.gz"

.PHONY: restore
restore: ## 백업 복구(DB+첨부): make restore FILE=data/backups/labmate_<시각>.tar.gz
	@[ -n "$(FILE)" ] || { echo "사용법: make restore FILE=data/backups/labmate_<시각>.tar.gz"; exit 1; }
	@[ -f "$(FILE)" ] || { echo "파일 없음: $(FILE)"; exit 1; }
	@printf "⚠ 현재 DB·첨부파일을 백업본으로 덮어씁니다(되돌릴 수 없음). 'yes' 입력: " && read ans && [ "$$ans" = "yes" ]
	@echo "→ 앱 서비스 정지"
	@$(COMPOSE) stop $(APP_SERVICES) >/dev/null 2>&1 || true
	@echo "→ 기존 DB 드롭"
	@for db in labmate_members labmate_projects labmate_funds labmate_attendance labmate_boards labmate_resource; do \
	  $(COMPOSE) exec -T postgres psql -U labmate -d postgres -c "DROP DATABASE IF EXISTS $$db WITH (FORCE);" >/dev/null 2>&1 || \
	  $(COMPOSE) exec -T postgres psql -U labmate -d postgres -c "DROP DATABASE IF EXISTS $$db;" >/dev/null 2>&1 || true; \
	done
	@echo "→ DB 적재"
	@docker run --rm -v $(PWD)/data:/data:ro alpine sh -c 'tar -xzOf /$(FILE) db.sql' | $(COMPOSE) exec -T postgres psql -U labmate -d postgres >/dev/null 2>&1 || true
	@echo "→ 첨부파일 복원"
	@docker run --rm -v $(PWD)/data:/data alpine sh -c 'rm -rf /data/uploads && tar -xzf /$(FILE) -C /data uploads'
	@echo "→ 서비스 재기동"
	@$(COMPOSE) up -d >/dev/null
	@echo "복구 완료: $(FILE)"

.PHONY: reset
reset: ## ⚠ 모든 데이터 삭제 후 관리자만 재시드(백업 먼저 권장)
	@printf "⚠ 모든 서비스 데이터를 삭제합니다. 계속하려면 'yes' 입력: " && read ans && [ "$$ans" = "yes" ]
	@for db in labmate_members labmate_projects labmate_funds labmate_attendance labmate_boards labmate_resource; do \
	  tbls=$$($(COMPOSE) exec -T postgres psql -U labmate -d $$db -tA -c \
	    "SELECT string_agg(format('%I',tablename),',') FROM pg_tables WHERE schemaname='public'"); \
	  [ -n "$$tbls" ] && $(COMPOSE) exec -T postgres psql -U labmate -d $$db -c \
	    "TRUNCATE $$tbls RESTART IDENTITY CASCADE" >/dev/null; \
	done
	@$(COMPOSE) restart members-service >/dev/null 2>&1
	@echo "초기화 완료 — 관리자(labmate@kloud.zone)만 재시드됨"

## ─── 정리 ───
.PHONY: clean
clean: ## 컨테이너+네트워크 제거(DB·업로드 데이터는 data/ 에 유지)
	$(COMPOSE) down --remove-orphans

.PHONY: clean-all
clean-all: ## ⚠ 컨테이너+볼륨+빌드이미지 제거(DB 데이터 data/ 는 별도. 완전 삭제는 make purge)
	@printf "⚠ 컨테이너·볼륨·이미지를 삭제합니다. 'yes' 입력: " && read ans && [ "$$ans" = "yes" ]
	$(COMPOSE) down -v --rmi local --remove-orphans

.PHONY: purge
purge: ## ⚠⚠ clean-all + data/(DB·업로드) 까지 영구 삭제 — 공장 초기화
	@printf "⚠⚠ DB·업로드 포함 모든 데이터를 영구 삭제합니다. 'PURGE' 입력: " && read ans && [ "$$ans" = "PURGE" ]
	$(COMPOSE) down -v --rmi local --remove-orphans
	docker run --rm -v $(PWD)/data:/d alpine sh -c 'rm -rf /d/postgres /d/uploads' || true
	@echo "data/postgres, data/uploads 삭제됨 — 다음 make up 시 새로 초기화"
