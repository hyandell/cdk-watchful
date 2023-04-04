import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import { Construct } from 'constructs';
import { IWatchful } from '../api';
import { WatchEcsServiceOptions } from '../ecs';
import { EcsMetricFactory } from '../monitoring/aws/ecs/metrics';


export interface WatchServiceProps extends WatchEcsServiceOptions {
  readonly title: string;
  readonly watchful: IWatchful;
  readonly service: ecs.BaseService;
  /**
   * Whether to add link section at the start of widget
   * @default - false
   */
  readonly skipLinkSection?: boolean;
}

export class WatchService extends Construct {

  private readonly watchful: IWatchful;
  private readonly ecsService: any;
  private readonly serviceName: string;
  private readonly clusterName: string;
  private readonly metrics: EcsMetricFactory;

  constructor(scope: Construct, id: string, props: WatchServiceProps) {
    super(scope, id);

    this.watchful = props.watchful;

    this.ecsService = props.service;
    this.serviceName = props.service.serviceName;
    this.clusterName = props.service.cluster.clusterName;


    this.metrics = new EcsMetricFactory();

    const skipLinkSection = props.skipLinkSection ?? false;

    if (!skipLinkSection) {
      this.watchful.addSection(props.title, {
        links: [
          { title: 'ECS Service', url: linkForEcsService(this.ecsService) },
        ],
      });
    }

    const { cpuUtilizationMetric, cpuUtilizationAlarm } = this.createCpuUtilizationMonitor(props.cpuMaximumThresholdPercent);
    const { memoryUtilizationMetric, memoryUtilizationAlarm } = this.createMemoryUtilizationMonitor(props.memoryMaximumThresholdPercent);


    this.watchful.addWidgets(
      new cloudwatch.GraphWidget({
        title: `CPUUtilization/${cpuUtilizationMetric.period.toMinutes()}min`,
        width: 12,
        left: [cpuUtilizationMetric],
        leftAnnotations: [cpuUtilizationAlarm.toAnnotation()],
      }),
      new cloudwatch.GraphWidget({
        title: `MemoryUtilization/${memoryUtilizationMetric.period.toMinutes()}min`,
        width: 12,
        left: [memoryUtilizationMetric],
        leftAnnotations: [memoryUtilizationAlarm.toAnnotation()],
      }),
    );
  }

  private createCpuUtilizationMonitor(cpuMaximumThresholdPercent = 0) {
    const cpuUtilizationMetric = this.metrics.metricCpuUtilizationAverage(this.clusterName, this.serviceName);
    const cpuUtilizationAlarm = cpuUtilizationMetric.createAlarm(this, 'cpuUtilizationAlarm', {
      alarmDescription: 'cpuUtilizationAlarm',
      threshold: cpuMaximumThresholdPercent,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 3,
    });
    this.watchful.addAlarm(cpuUtilizationAlarm);
    return { cpuUtilizationMetric, cpuUtilizationAlarm };
  }

  private createMemoryUtilizationMonitor(memoryMaximumThresholdPercent = 0) {
    const memoryUtilizationMetric = this.metrics.metricMemoryUtilizationAverage(this.clusterName, this.serviceName);
    const memoryUtilizationAlarm = memoryUtilizationMetric.createAlarm(this, 'memoryUtilizationAlarm', {
      alarmDescription: 'memoryUtilizationAlarm',
      threshold: memoryMaximumThresholdPercent,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 3,
    });
    this.watchful.addAlarm(memoryUtilizationAlarm);
    return { memoryUtilizationMetric, memoryUtilizationAlarm };
  }

}

export function linkForEcsService(ecsService: any) {
  return `https://console.aws.amazon.com/ecs/home?region=${ecsService.stack.region}#/clusters/${ecsService.cluster.clusterName}/services/${ecsService.serviceName}/details`;
}
