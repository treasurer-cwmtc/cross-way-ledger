"""Cloud Function (HTTP, invoked hourly by Cloud Scheduler): stops
ledger-db-dev if it's been idle for IDLE_HOURS, based on Cloud SQL's own
CPU utilization metric. Never touches ledger-db-prod.

There is no automatic wake-up - Cloud SQL has no way to detect "someone is
about to connect" and start itself back up, unlike a serverless database.
Starting it again is a manual step:

    gcloud sql instances patch ledger-db-dev --activation-policy=ALWAYS

See docs/DEPLOYMENT.md for the full write-up.
"""
import time

import functions_framework
from google.cloud import monitoring_v3
from googleapiclient import discovery

PROJECT_ID = "cross-way-ledger"
INSTANCE = "ledger-db-dev"
IDLE_HOURS = 12
# Cloud SQL's own dashboard/backup/replication housekeeping keeps CPU above
# 0% even when genuinely idle - 3% comfortably separates "nothing happened"
# from "a real query ran."
CPU_IDLE_THRESHOLD = 0.03


@functions_framework.http
def check_and_stop_dev_db(request):
    sqladmin = discovery.build("sqladmin", "v1beta4", cache_discovery=False)
    instance = sqladmin.instances().get(project=PROJECT_ID, instance=INSTANCE).execute()

    if instance["settings"]["activationPolicy"] == "NEVER":
        return f"{INSTANCE} is already stopped - nothing to do.", 200

    client = monitoring_v3.MetricServiceClient()
    now = time.time()
    interval = monitoring_v3.TimeInterval(
        {
            "end_time": {"seconds": int(now)},
            "start_time": {"seconds": int(now - IDLE_HOURS * 3600)},
        }
    )
    results = client.list_time_series(
        request={
            "name": f"projects/{PROJECT_ID}",
            "filter": (
                'metric.type="cloudsql.googleapis.com/database/cpu/utilization" '
                f'AND resource.labels.database_id="{PROJECT_ID}:{INSTANCE}"'
            ),
            "interval": interval,
            "view": monitoring_v3.ListTimeSeriesRequest.TimeSeriesView.FULL,
        }
    )

    max_cpu = 0.0
    for series in results:
        for point in series.points:
            max_cpu = max(max_cpu, point.value.double_value)

    if max_cpu > CPU_IDLE_THRESHOLD:
        msg = f"{INSTANCE} active (max CPU {max_cpu:.1%} over last {IDLE_HOURS}h) - leaving it running."
        print(msg)
        return msg, 200

    sqladmin.instances().patch(
        project=PROJECT_ID,
        instance=INSTANCE,
        body={"settings": {"activationPolicy": "NEVER"}},
    ).execute()
    msg = f"{INSTANCE} idle for {IDLE_HOURS}h+ (max CPU {max_cpu:.1%}) - stopped to save cost."
    print(msg)
    return msg, 200
