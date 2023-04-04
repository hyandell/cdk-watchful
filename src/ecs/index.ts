import { Names } from 'aws-cdk-lib';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import { ApplicationTargetGroup } from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { Construct } from 'constructs';
import { IWatchful } from '../api';
import { linkForEcsService, WatchService } from './service';
import { WatchTargetGroup } from './target-group';

export * from './target-group';
export * from './service';


export interface WatchEcsServiceOptions {
  /**
     * Threshold for the Cpu Maximum utilization
     *
     * @default 80
     */
  readonly cpuMaximumThresholdPercent?: number;

  /**
   * Threshold for the Memory Maximum utilization.
   *
   * @default - 0.
   */
  readonly memoryMaximumThresholdPercent?: number;

  /**
   * Threshold for the Target Response Time.
   *
   * @default - 0.
   */
  readonly targetResponseTimeThreshold?: number;

  /**
   * Threshold for the Number of Requests.
   *
   * @default - 0.
   */
  readonly requestsThreshold?: number;

  /**
   * Threshold for the Number of Request Errors.
   *
   * @default - 0.
   */
  readonly requestsErrorRateThreshold?: number;
}

export interface WatchEcsServiceProps extends WatchEcsServiceOptions {
  readonly title: string;
  readonly watchful: IWatchful;
  readonly fargateService?: ecs.FargateService;
  readonly ec2Service?: ecs.Ec2Service;
  readonly targetGroup: ApplicationTargetGroup;
}

export class WatchEcsService extends Construct {

  private readonly watchful: IWatchful;
  private readonly ecsService: ecs.BaseService;

  constructor(scope: Construct, id: string, props: WatchEcsServiceProps) {
    super(scope, id);

    this.watchful = props.watchful;

    if (!props.ec2Service || !props.fargateService) {
      throw new Error('No service provided to monitor.');
    };

    this.ecsService = props.ec2Service ?? props.fargateService;

    this.watchful.addSection(props.title, {
      links: [
        { title: 'ECS Service', url: linkForEcsService(this.ecsService) },
      ],
    });

    new WatchService(this, Names.uniqueId(this.ecsService), {
      ...props,
      service: this.ecsService,
      skipLinkSection: true,
    });

    new WatchTargetGroup(this, Names.uniqueId(props.targetGroup), {
      ...props,
      skipLinkSection: true,
    });
  }

}
