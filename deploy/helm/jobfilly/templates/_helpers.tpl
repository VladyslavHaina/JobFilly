{{/* The release's base name, cut to fit Kubernetes' 63-character limit. */}}
{{- define "jobfilly.fullname" -}}
{{- if contains .Chart.Name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name .Chart.Name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{- define "jobfilly.postgresql.fullname" -}}
{{- printf "%s-postgresql" (include "jobfilly.fullname" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "jobfilly.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" }}
app.kubernetes.io/name: {{ .Chart.Name }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "jobfilly.selectorLabels" -}}
app.kubernetes.io/name: {{ .Chart.Name }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/component: server
{{- end -}}

{{- define "jobfilly.postgresql.selectorLabels" -}}
app.kubernetes.io/name: {{ .Chart.Name }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/component: postgresql
{{- end -}}

{{/* The Secret the app reads its secret settings from. */}}
{{- define "jobfilly.secretName" -}}
{{- default (include "jobfilly.fullname" .) .Values.existingSecret -}}
{{- end -}}

{{/* PUBLIC_URL: the configured one, else the Ingress host, else the port-forward address. */}}
{{- define "jobfilly.publicUrl" -}}
{{- if .Values.config.publicUrl -}}
{{- .Values.config.publicUrl -}}
{{- else if .Values.ingress.enabled -}}
{{- printf "%s://%s" (ternary "https" "http" (not (empty .Values.ingress.tls.secretName))) .Values.ingress.host -}}
{{- else -}}
{{- printf "http://127.0.0.1:%v" .Values.port -}}
{{- end -}}
{{- end -}}

{{/* DATABASE_URL: the configured one, else the bundled database when it is on. */}}
{{- define "jobfilly.databaseUrl" -}}
{{- if .Values.secret.databaseUrl -}}
{{- .Values.secret.databaseUrl -}}
{{- else if .Values.postgresql.enabled -}}
{{- $pg := .Values.postgresql.auth -}}
{{- printf "postgres://%s:%s@%s:5432/%s" $pg.username (urlquery (include "jobfilly.postgresql.password" .)) (include "jobfilly.postgresql.fullname" .) $pg.database -}}
{{- end -}}
{{- end -}}

{{- define "jobfilly.postgresql.password" -}}
{{- required "postgresql.auth.password is required with postgresql.enabled (openssl rand -hex 24)" .Values.postgresql.auth.password -}}
{{- end -}}
