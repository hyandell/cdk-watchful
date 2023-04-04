import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import { TargetGroupBase } from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { Construct } from 'constructs';
import { IWatchful } from '../api';
import { WatchEcsServiceOptions } from '../ecs';
import { EcsMetricFactory } from '../monitoring/aws/ecs/metrics';

export interface WatchTargetGroupProps extends WatchEcsServiceOptions {
  readonly title: string;
  readonly watchful: IWatchful;
  readonly targetGroup: TargetGroupBase;
  /**
   * Whether to add link section at the start of widget
   * @default - false
   */
  readonly skipLinkSection?: boolean;
}

export class WatchTargetGroup extends Construct {

  private readonly watchful: IWatchful;
  private readonly targetGroup: TargetGroupBase;
  private readonly targetGroupName: string;
  private readonly loadBalancerName: string;
  private readonly metrics: EcsMetricFactory;

  constructor(scope: Construct, id: string, props: WatchTargetGroupProps) {
    super(scope, id);

    this.watchful = props.watchful;

    this.targetGroup = props.targetGroup;
    this.targetGroupName = this.targetGroup.targetGroupFullName;
    this.loadBalancerName = this.targetGroup.firstLoadBalancerFullName;
    this.metrics = new EcsMetricFactory();

    const skipLinkSection = props.skipLinkSection ?? false;
    console.log('###DEBUG-skipLinkSection:', skipLinkSection);

    console.log('###DEBUG-linkForTargetGroup(this.targetGroup):', linkForTargetGroup(this.targetGroup));
    if (!skipLinkSection) {
      this.watchful.addSection(props.title, {
        links: [
          { title: 'ECS Target Group', url: linkForTargetGroup(this.targetGroup) },
        ],
      });
    }

    const { targetResponseTimeMetric, targetResponseTimeAlarm } = this.createTargetResponseTimeMonitor(props.targetResponseTimeThreshold);
    const { healthyHostsMetric, unhealthyHostsMetric } = this.createHostCountMetrics();

    const { requestsMetric, requestsAlarm } = this.createRequestsMonitor(props.requestsThreshold);
    const { http2xxMetric, http3xxMetric, http4xxMetric, http5xxMetric } = this.createHttpRequestsMetrics();
    const { requestsErrorRateMetric, requestsErrorRateAlarm } = this.requestsErrorRate(props.requestsErrorRateThreshold);

    this.watchful.addWidgets(
      new cloudwatch.SingleValueWidget({
        title: 'Healthy Hosts',
        height: 6,
        width: 6,
        metrics: [healthyHostsMetric],
      }),
      new cloudwatch.SingleValueWidget({
        title: 'UnHealthy Hosts',
        height: 6,
        width: 6,
        metrics: [unhealthyHostsMetric],
      }),
      new cloudwatch.GraphWidget({
        title: `TargetResponseTime/${targetResponseTimeMetric.period.toMinutes()}min`,
        width: 6,
        left: [targetResponseTimeMetric],
        leftAnnotations: [targetResponseTimeAlarm.toAnnotation()],
      }),
      new cloudwatch.GraphWidget({
        title: `Requests/${requestsMetric.period.toMinutes()}min`,
        width: 6,
        left: [requestsMetric],
        leftAnnotations: [requestsAlarm.toAnnotation()],
      }),
    );
    this.watchful.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'HTTP Requests Overview',
        width: 12,
        left: [http2xxMetric, http3xxMetric, http4xxMetric, http5xxMetric],
      }),
      new cloudwatch.GraphWidget({
        title: `HTTP Requests Error rate/${requestsErrorRateMetric.period.toMinutes()}min`,
        width: 12,
        left: [requestsErrorRateMetric],
        leftAnnotations: [requestsErrorRateAlarm.toAnnotation()],
      }),
    );
  }

  private createTargetResponseTimeMonitor(targetResponseTimeThreshold = 0) {
    const targetResponseTimeMetric = this.metrics.metricTargetResponseTime(this.targetGroupName, this.loadBalancerName).avg;
    const targetResponseTimeAlarm = targetResponseTimeMetric.createAlarm(this, 'targetResponseTimeAlarm', {
      alarmDescription: 'targetResponseTimeAlarm',
      threshold: targetResponseTimeThreshold,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 3,
    });
    this.watchful.addAlarm(targetResponseTimeAlarm);
    return { targetResponseTimeMetric, targetResponseTimeAlarm };
  }

  private createRequestsMonitor(requestsThreshold = 0) {
    const requestsMetric = this.metrics.metricRequestCount(this.targetGroupName, this.loadBalancerName);
    const requestsAlarm = requestsMetric.createAlarm(this, 'requestsAlarm', {
      alarmDescription: 'requestsAlarm',
      threshold: requestsThreshold,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 3,
    });
    this.watchful.addAlarm(requestsAlarm);
    return { requestsMetric, requestsAlarm };
  }


  private createHttpRequestsMetrics() {
    const metrics = this.metrics.metricHttpStatusCodeCount(this.targetGroupName, this.loadBalancerName);
    const http2xxMetric = metrics.count2XX;
    const http3xxMetric = metrics.count3XX;
    const http4xxMetric = metrics.count4XX;
    const http5xxMetric = metrics.count5XX;
    return { http2xxMetric, http3xxMetric, http4xxMetric, http5xxMetric };
  }

  private createHostCountMetrics() {
    const healthyHostsMetric = this.metrics.metricMinHealthyHostCount(this.targetGroupName, this.loadBalancerName);
    const unhealthyHostsMetric = this.metrics.metricMaxUnhealthyHostCount(this.targetGroupName, this.loadBalancerName);
    return { healthyHostsMetric, unhealthyHostsMetric };
  }

  private requestsErrorRate(requestsErrorRateThreshold = 0) {
    const requestsErrorRateMetric = this.metrics.metricHttpErrorStatusCodeRate(this.targetGroupName, this.loadBalancerName);
    const requestsErrorRateAlarm = requestsErrorRateMetric.createAlarm(this, 'requestsErrorRateAlarm', {
      alarmDescription: 'requestsErrorRateAlarm',
      threshold: requestsErrorRateThreshold,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 3,
    });
    this.watchful.addAlarm(requestsErrorRateAlarm);
    return { requestsErrorRateMetric, requestsErrorRateAlarm };
  }

}

export function linkForTargetGroup(targetGroup: any) {
  return `https://console.aws.amazon.com/ecs/home?region=${targetGroup.node.scope?.region}#TargetGroup:targetGroupArn=${targetGroup.targetGroupArn}`;
}
