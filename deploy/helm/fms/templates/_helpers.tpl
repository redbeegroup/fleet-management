{{- define "fms.name" -}}fms{{- end -}}

{{- define "fms.fullname" -}}
{{- if contains "fms" .Release.Name -}}{{ .Release.Name | trunc 50 | trimSuffix "-" }}
{{- else -}}{{ printf "%s-fms" .Release.Name | trunc 50 | trimSuffix "-" }}{{- end -}}
{{- end -}}

{{- define "fms.labels" -}}
app.kubernetes.io/name: {{ include "fms.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version }}
{{- end -}}

{{- define "fms.selectorLabels" -}}
app.kubernetes.io/name: {{ include "fms.name" .root }}
app.kubernetes.io/instance: {{ .root.Release.Name }}
app.kubernetes.io/component: {{ .component }}
{{- end -}}

{{- define "fms.image" -}}
{{- $img := index .root.Values.image .which -}}
{{- $repo := $img.repository -}}
{{- if .root.Values.global.imageRegistry -}}{{- $repo = printf "%s/%s" .root.Values.global.imageRegistry (base $img.repository) -}}{{- end -}}
{{- printf "%s:%s" $repo (default .root.Chart.AppVersion $img.tag) -}}
{{- end -}}

{{- define "fms.secretName" -}}
{{- if .Values.secrets.existingSecret -}}{{ .Values.secrets.existingSecret }}
{{- else -}}{{ include "fms.fullname" . }}-secrets{{- end -}}
{{- end -}}

{{- define "fms.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}{{ default (include "fms.fullname" .) .Values.serviceAccount.name }}
{{- else -}}{{ default "default" .Values.serviceAccount.name }}{{- end -}}
{{- end -}}

{{/* Environment shared by api / worker / ingest / migrations. */}}
{{- define "fms.apiEnv" -}}
envFrom:
  - configMapRef:
      name: {{ include "fms.fullname" . }}-config
env:
  {{- range $key := list "DATABASE_URL" "DATABASE_MIGRATION_URL" "JWT_ACCESS_SECRET" }}
  - name: {{ $key }}
    valueFrom:
      secretKeyRef:
        name: {{ include "fms.secretName" $ }}
        key: {{ $key }}
  {{- end }}
  {{- if .Values.redis.internal.enabled }}
  - name: REDIS_URL
    value: redis://{{ include "fms.fullname" . }}-redis:6379
  {{- else }}
  - name: REDIS_URL
    valueFrom:
      secretKeyRef:
        name: {{ include "fms.secretName" . }}
        key: REDIS_URL
  {{- end }}
  {{- range $key := list "WATCHTOWER_API_KEY" "S3_ACCESS_KEY" "S3_SECRET_KEY" "SMTP_URL" }}
  - name: {{ $key }}
    valueFrom:
      secretKeyRef:
        name: {{ include "fms.secretName" $ }}
        key: {{ $key }}
        optional: true
  {{- end }}
{{- end -}}

{{- define "fms.podSecurity" -}}
{{- with .Values.global.imagePullSecrets }}
imagePullSecrets:
  {{- toYaml . | nindent 2 }}
{{- end }}
serviceAccountName: {{ include "fms.serviceAccountName" . }}
automountServiceAccountToken: false
securityContext:
  {{- toYaml .Values.podSecurityContext | nindent 2 }}
{{- with .Values.nodeSelector }}
nodeSelector:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- with .Values.tolerations }}
tolerations:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- with .Values.affinity }}
affinity:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- end -}}
